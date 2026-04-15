"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronRight as ExpandIcon,
  Search,
  Download,
  RefreshCw,
  MessageSquarePlus,
  History,
  MessageSquare,
  StickyNote,
  ArrowRight,
  Expand,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check } from "lucide-react";
import { FilterBar } from "@/components/shared/FilterBar";
import { ClientStatusSelect } from "@/components/clients/ClientStatusSelect";
import { PageBack } from "@/components/layout/PageBack";
import { AddNoteDialog } from "@/components/clients/AddNoteDialog";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";
import { getLevelBadgeColor, formatNumber, cn } from "@/lib/utils";
import { ALLOWED_CUSTOMER_TYPES, allowedCustomerTypesList } from "@/lib/customerTypes";
import { dataCache } from "@/lib/dataCache";
import { fetchClientMeterOrderImportFields } from "@/lib/orderImportMeta";
import { isKartelaProductName, kartelaFamilyBaseKey } from "@/lib/kartelaProduct";
import type { ClientStatus, OrderLevel } from "@/types/database";

const CLIENTS_PERSIST_PREFIX = "clients_boot_v1:";

interface ClientRow {
  id: string;
  partner_id: string;
  name: string;
  salesperson_name: string | null;
  salesperson_code: string | null;
  top_product_name: string | null;
  top_product_cartela: number;
  current_status: ClientStatus;
  total_meters: number;
  total_revenue: number;
  order_count: number;
  customer_type: string | null;
  cartela_count: number;
  level: OrderLevel;
  notes: string | null;
  month: number;
  year: number;
  kartela_month: number | null;
  kartela_year: number | null;
  kartela_cross_month: boolean;
  /** From meter order lines (import): product category */
  order_import_category: string | null;
  order_import_pricelist: string | null;
  order_import_invoice: string | null;
}

function withOrderImportFields(c: ClientRow): ClientRow {
  return {
    ...c,
    order_import_category: c.order_import_category ?? null,
    order_import_pricelist: c.order_import_pricelist ?? null,
    order_import_invoice: c.order_import_invoice ?? null,
  };
}

export default function ClientsPage() {
  const { locale, filters, salespersonId, currentUser } = useStore();
  const isRTL = locale === "ar";
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [partialLoadInfo, setPartialLoadInfo] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState(() => searchParams.get("search") ?? "");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
    const cf: ColumnFiltersState = [];
    const product = searchParams.get("product");
    if (product) {
      const vals = product.includes(",")
        ? product.split(",").map((s) => s.trim()).filter(Boolean)
        : [product];
      cf.push({ id: "top_product_name", value: vals.length > 1 ? vals : vals[0] });
    }
    return cf;
  });
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null);
  const [dialogType, setDialogType] = useState<"note" | "history" | null>(null);
  const didApplyUrlParams = useRef(false);

  // Apply URL search params once on first load
  useEffect(() => {
    if (didApplyUrlParams.current) return;
    didApplyUrlParams.current = true;
    const search  = searchParams.get("search");
    const product = searchParams.get("product");
    if (search)  setGlobalFilter(search);
    if (product) {
      const vals = product.includes(",")
        ? product.split(",").map((s) => s.trim()).filter(Boolean)
        : [product];
      setColumnFilters((cf) => {
        const without = cf.filter((f) => f.id !== "top_product_name");
        return [...without, { id: "top_product_name", value: vals.length > 1 ? vals : vals[0] }];
      });
    }
  }, [searchParams]);

  // Sync status/level store filters → table column filters (instant, no Supabase call)
  useEffect(() => {
    const cf: ColumnFiltersState = [];
    if (filters.selectedStatus) cf.push({ id: "current_status", value: filters.selectedStatus });
    if (filters.selectedLevel)  cf.push({ id: "level",          value: filters.selectedLevel });
    setColumnFilters((prev) => {
      const preserved = prev.filter((f) => !["current_status", "level"].includes(f.id));
      return [...preserved, ...cf];
    });
  }, [filters.selectedStatus, filters.selectedLevel]);

  const fetchClients = useCallback(async (forceRefresh = false) => {
    setFetchError(null);
    setPartialLoadInfo(null);
    const supabase = createClient();
    const now = new Date();
    const selectedMonth = filters.selectedMonth ?? (now.getMonth() + 1);
    const selectedYear  = filters.selectedYear  ?? now.getFullYear();
    const spFilter      = salespersonId || filters.selectedSalesperson;
    const cacheKey = `clients_v11:${selectedYear}-${selectedMonth}-${spFilter || "all"}`;
    const persistKey = `${CLIENTS_PERSIST_PREFIX}${cacheKey}`;

    // ── Global session cache hit → render instantly ──────────────────────
    if (!forceRefresh) {
      const cached = dataCache.get<ClientRow[]>(cacheKey);
      if (cached) {
        setClients(cached.map(withOrderImportFields));
        setLoading(false);
        return;
      }
    }

    // ── Fast boot cache (page reload) ────────────────────────────────────
    let hasBootData = false;
    if (!forceRefresh && typeof window !== "undefined") {
      try {
        const raw = window.sessionStorage.getItem(persistKey);
        if (raw) {
          const persisted = JSON.parse(raw) as ClientRow[];
          if (Array.isArray(persisted) && persisted.length > 0) {
            setClients(persisted.map((c) => withOrderImportFields(c as ClientRow)));
            setLoading(false);
            hasBootData = true;
          }
        }
      } catch {
        // ignore broken storage
      }
    }

    if (!hasBootData) setLoading(true);
    try {
      const withTimeout = async <T,>(p: Promise<T>, ms: number): Promise<T> =>
        await Promise.race([
          p,
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout-${ms}ms`)), ms)),
        ]);

      const VIEW_COLS = "client_id, partner_id, client_name, current_status, total_meters, total_revenue, order_count, customer_type, level, cartela_count, top_product_cartela, top_product_name, salesperson_id, salesperson_name, salesperson_code, month, year, kartela_month, kartela_year, kartela_cross_month";
      const wantInactive = filters.selectedLevel === "INACTIVE";

      const buildViewQ = () => {
        let q = supabase
          .from("client_monthly_metrics")
          .select(VIEW_COLS)
          .eq("month", selectedMonth)
          .eq("year", selectedYear)
          .in("customer_type", [...ALLOWED_CUSTOMER_TYPES]);
        if (spFilter) q = q.eq("salesperson_id", spFilter);
        return q;
      };
      const inactiveClientsQ = (() => {
        if (!wantInactive) return Promise.resolve({ data: [] as any[], error: null });
        let q = supabase
          .from("clients")
          .select("id, partner_id, name, salesperson_id, current_status, customer_type")
          .in("customer_type", [...ALLOWED_CUSTOMER_TYPES])
          .range(0, 9999);
        if (spFilter) q = q.eq("salesperson_id", spFilter);
        return q;
      })();

      const fetchViewPage = async (offset: number, limit: number, retries = 1): Promise<any[]> => {
        let attempt = 0;
        while (attempt <= retries) {
          try {
            const res: any = await withTimeout(
              Promise.resolve(buildViewQ().range(offset, offset + limit - 1)),
              9000
            );
            if (res.error) throw new Error(res.error.message);
            return res.data ?? [];
          } catch (err) {
            if (attempt >= retries) throw err;
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          }
          attempt += 1;
        }
        return [];
      };

      const countQ = (() => {
        let q = supabase
          .from("client_monthly_metrics")
          .select("client_id", { count: "exact", head: true })
          .eq("month", selectedMonth)
          .eq("year", selectedYear)
          .in("customer_type", [...ALLOWED_CUSTOMER_TYPES]);
        if (spFilter) q = q.eq("salesperson_id", spFilter);
        return q;
      })();

      const PAGE_SIZE = 1000;
      const [countRes, firstPageRows, spData, inactiveClientsResult] = await Promise.all([
        withTimeout(Promise.resolve(countQ), 8000).catch(() => ({ count: null } as any)),
        fetchViewPage(0, PAGE_SIZE, 3),
        supabase.from("salespersons").select("id, name, code"),
        withTimeout(Promise.resolve(inactiveClientsQ), 6000).catch(() => ({ data: [] as any[], error: { message: "inactive timeout" } as any })),
      ]);

      const viewRows = [...firstPageRows];
      const expectedCount = Number((countRes as any)?.count) || 0;
      if (firstPageRows.length >= PAGE_SIZE) {
        setLoadingMore(true);
        for (let offset = PAGE_SIZE; ; offset += PAGE_SIZE) {
          if (expectedCount > 0 && offset >= expectedCount) break;
          const pageRows = await fetchViewPage(offset, PAGE_SIZE, 4);
          if (!pageRows.length) break;
          viewRows.push(...pageRows);
          if (pageRows.length < PAGE_SIZE) break;
        }
        setLoadingMore(false);
      }

      const spMap = new Map<string, { name: string; code: string }>(
        (spData.data || []).map((s: any) => [s.id, { name: s.name, code: s.code }])
      );

      // Deduplicate view rows per client (keep highest total_meters)
      const orderMap = new Map<string, any>();
      viewRows.forEach((r: any) => {
        const prev = orderMap.get(r.client_id);
        if (!prev || (Number(r.total_meters) || 0) > (Number(prev.total_meters) || 0)) {
          orderMap.set(r.client_id, r);
        }
      });

      const combined: ClientRow[] = [];
      const seenIds = new Set<string>();

      // Step A: active clients from the view (GREEN / ORANGE / RED)
      orderMap.forEach((ord: any) => {
        seenIds.add(ord.client_id);
        const sp = spMap.get(ord.salesperson_id);
        combined.push({
          id:                  ord.client_id,
          partner_id:          ord.partner_id  || ord.client_id,
          name:                ord.client_name || "—",
          salesperson_name:    ord.salesperson_name || sp?.name  || null,
          salesperson_code:    ord.salesperson_code || sp?.code  || null,
          top_product_name:    ord.top_product_name || null,
          top_product_cartela: Number(ord.top_product_cartela) || 0,
          current_status:      (ord.current_status ?? "NEW") as ClientStatus,
          total_meters:        Number(ord.total_meters)   || 0,
          total_revenue:       Number(ord.total_revenue)  || 0,
          order_count:         Number(ord.order_count)    || 0,
          customer_type:       ord.customer_type || null,
          cartela_count:       Number(ord.cartela_count)  || 0,
          level:               (ord.level ?? "RED") as OrderLevel,
          notes:               null,
          month:               Number(ord.month) || selectedMonth,
          year:                Number(ord.year)  || selectedYear,
          kartela_month:       ord.kartela_month ? Number(ord.kartela_month) : null,
          kartela_year:        ord.kartela_year  ? Number(ord.kartela_year)  : null,
          kartela_cross_month: Boolean(ord.kartela_cross_month),
          order_import_category: null,
          order_import_pricelist: null,
          order_import_invoice: null,
        });
      });

      // Step B: dormant clients — only fetched when user explicitly filters for INACTIVE
      if (wantInactive) {
        (inactiveClientsResult.data ?? []).forEach((c: any) => {
          if (seenIds.has(c.id)) return;
          const sp = spMap.get(c.salesperson_id);
          combined.push({
            id: c.id, partner_id: c.partner_id, name: c.name,
            salesperson_name: sp?.name || null, salesperson_code: sp?.code || null,
            top_product_name: null, top_product_cartela: 0,
            current_status: c.current_status as ClientStatus,
            total_meters: 0, total_revenue: 0, order_count: 0,
            customer_type: c.customer_type || null, cartela_count: 0,
            level: "INACTIVE" as OrderLevel, notes: null,
            month: selectedMonth, year: selectedYear,
            kartela_month: null, kartela_year: null, kartela_cross_month: false,
            order_import_category: null,
            order_import_pricelist: null,
            order_import_invoice: null,
          });
        });
      }

      // Step C: category / pricelist / invoice from meter lines (selected month)
      // Chunked to avoid very large IN filters/timeouts.
      const idsForImport = combined.map((c) => c.id);
      if (idsForImport.length > 0) {
        const mergedByClient = new Map<string, { category: string; pricelist: string; invoice: string }>();
        const CHUNK = 800;
        for (let i = 0; i < idsForImport.length; i += CHUNK) {
          const chunk = idsForImport.slice(i, i + CHUNK);
          const { byClient } = await withTimeout(
            fetchClientMeterOrderImportFields(supabase, chunk, selectedMonth, selectedYear),
            9000
          ).catch(() => ({ byClient: new Map<string, { category: string; pricelist: string; invoice: string }>() }));
          byClient.forEach((v, k) => mergedByClient.set(k, v));
        }
        combined.forEach((c) => {
          const m = mergedByClient.get(c.id);
          if (!m) return;
          c.order_import_category = m.category || null;
          c.order_import_pricelist = m.pricelist || null;
          c.order_import_invoice = m.invoice || null;
        });
      }

      // Performance: skip per-client notes/status hydration here.
      // Notes are loaded in expanded log panel on demand.

      combined.sort((a, b) => b.total_meters - a.total_meters);
      dataCache.set(cacheKey, combined);
      if (typeof window !== "undefined") {
        try { window.sessionStorage.setItem(persistKey, JSON.stringify(combined)); } catch {}
      }
      setClients(combined);

      if (expectedCount > 0 && viewRows.length < expectedCount) {
        setPartialLoadInfo(
          isRTL
            ? `تم تحميل ${viewRows.length.toLocaleString()} من أصل ${expectedCount.toLocaleString()} عميل. أعد التحميل لاستكمال الباقي.`
            : `Loaded ${viewRows.length.toLocaleString()} of ${expectedCount.toLocaleString()} clients. Refresh to load the remainder.`
        );
      } else if (combined.length === 0) {
        setFetchError(isRTL ? "التحميل بطيء حالياً، حاول مرة أخرى خلال ثوانٍ." : "Loading is currently slow, please retry in a few seconds.");
      }

    } catch (err: any) {
      setFetchError(err?.message || "Network error — check Supabase connection");
    }

    setLoading(false);
    setLoadingMore(false);
  }, [filters.selectedMonth, filters.selectedYear, filters.selectedSalesperson, salespersonId]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const MONTH_NAMES_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  const MONTH_NAMES_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const t = {
    title: isRTL ? "العملاء" : "Clients",
    subtitle: isRTL ? "إدارة ومتابعة جميع حسابات العملاء" : "Manage and monitor all client accounts",
    search: isRTL ? "بحث عن عميل، رقم، منتج..." : "Search client, ID, product...",
    partner: isRTL ? "رقم الشريك" : "Partner ID",
    client: isRTL ? "العميل" : "Client",
    salesperson: isRTL ? "المندوب" : "Salesperson",
    product: isRTL ? "المنتج" : "Product",
    importCategory: isRTL ? "التصنيف" : "Category",
    importPricelist: isRTL ? "قائمة الأسعار" : "Pricelist",
    importInvoice: isRTL ? "فاتوره" : "Invoice",
    meters: isRTL ? "الأمتار" : "Meters",
    cartela: isRTL ? "كارتله" : "Cartelah",
    date: isRTL ? "الشهر" : "Month",
    status: isRTL ? "الحالة" : "Status",
    level: isRTL ? "المستوى" : "Level",
    actions: isRTL ? "الإجراءات" : "Actions",
    updateStatus: isRTL ? "تحديث الحالة" : "Update Status",
    addNote: isRTL ? "ملاحظة" : "Note",
    history: isRTL ? "السجل" : "History",
    export: isRTL ? "تصدير" : "Export",
    prev: isRTL ? "السابق" : "Previous",
    next: isRTL ? "التالي" : "Next",
    page: isRTL ? "صفحة" : "Page",
    of: isRTL ? "من" : "of",
    rows: isRTL ? "صفوف" : "rows",
    showing: isRTL ? "عرض" : "Showing",
  };

  const levelLabels: Record<OrderLevel, string> = {
    GREEN:    isRTL ? "طلبات ≥ 100م"               : "Orders ≥ 100m",
    ORANGE:   isRTL ? "طلبات < 100م"               : "Orders < 100m",
    RED:      isRTL ? "كارتيلا فقط — بدون أمتار"   : "Cartela Only",
    INACTIVE: isRTL ? "خامل (Dormant)"               : "Dormant",
  };

  const statusLabels: Record<ClientStatus, string> = {
    NEW: isRTL ? "جديد" : "New",
    FOLLOW_UP_1: isRTL ? "متابعة 1" : "Follow Up 1",
    FOLLOW_UP_2: isRTL ? "متابعة 2" : "Follow Up 2",
    RECOVERED: isRTL ? "مستعاد" : "Recovered",
    LOST: isRTL ? "مفقود" : "Lost",
    CANCELLED: isRTL ? "ملغى" : "Cancelled",
  };

  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [prodOpen, setProdOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [clientFilterOpen, setClientFilterOpen] = useState(false);

  // Expandable log panel state
  const [expanded,   setExpanded]   = useState<Record<string, boolean>>({});
  const [logCache,   setLogCache]   = useState<Record<string, any[]>>({});
  const [logLoading, setLogLoading] = useState<Record<string, boolean>>({});

  const fetchLog = async (clientId: string) => {
    if (logCache[clientId]) return;
    setLogLoading((p) => ({ ...p, [clientId]: true }));
    const supabase = createClient();
    const [{ data: hist }, { data: acts }] = await Promise.all([
      supabase.from("client_status_history")
        .select("id,old_status,new_status,reason,created_at,users(full_name)")
        .eq("client_id", clientId).order("created_at", { ascending: false }).limit(15),
      supabase.from("activity_logs")
        .select("id,activity_type,description,metadata,created_at,users(full_name)")
        .eq("entity_id", clientId).order("created_at", { ascending: false }).limit(15),
    ]);
    const entries = [
      ...(hist ?? []).map((h: any) => ({
        id: `h_${h.id}`, type: "STATUS_CHANGE",
        metadata: { old_status: h.old_status, new_status: h.new_status, reason: h.reason },
        created_at: h.created_at, user_name: h.users?.full_name ?? "—",
      })),
      ...(acts ?? []).filter((a: any) => a.activity_type === "NOTE_ADDED").map((a: any) => ({
        id: `a_${a.id}`, type: "NOTE_ADDED",
        metadata: a.metadata, created_at: a.created_at, user_name: a.users?.full_name ?? "—",
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setLogCache((p) => ({ ...p, [clientId]: entries }));
    setLogLoading((p) => ({ ...p, [clientId]: false }));
  };

  const toggleExpand = (id: string) => {
    const opening = !expanded[id];
    setExpanded((p) => ({ ...p, [id]: opening }));
    if (opening) fetchLog(id);
  };

  const invalidateClientCache = () => {
    dataCache.invalidate("clients_v11:");
  };
  const toggleRow = (id: string) => setSelectedRows(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (rows: ClientRow[]) => setSelectedRows(prev => prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id)));

  const STATUS_LABELS_EN: Record<string, string> = {
    NEW: "New", FOLLOW_UP_1: "Follow Up 1", FOLLOW_UP_2: "Follow Up 2",
    RECOVERED: "Recovered", LOST: "Lost", CANCELLED: "Cancelled",
  };
  const STATUS_LABELS_AR: Record<string, string> = {
    NEW: "جديد", FOLLOW_UP_1: "متابعة 1", FOLLOW_UP_2: "متابعة 2",
    RECOVERED: "مستعاد", LOST: "مفقود", CANCELLED: "ملغى",
  };

  const columns: ColumnDef<ClientRow>[] = [
    // ── Expand ────────────────────────────────────────────────────────
    {
      id: "expand",
      header: "",
      cell: ({ row }) => (
        <button
          onClick={(e) => { e.stopPropagation(); toggleExpand(row.original.id); }}
          className={`p-1 rounded transition-colors hover:bg-muted ${expanded[row.original.id] ? "text-primary" : "text-muted-foreground"}`}
        >
          <ExpandIcon className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded[row.original.id] ? "rotate-90" : ""}`} />
        </button>
      ),
      size: 28,
    },
    // ── Checkbox ──────────────────────────────────────────────────────
    {
      id: "select",
      header: ({ table }) => (
        <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer rounded border-border"
          checked={table.getRowModel().rows.length > 0 && table.getRowModel().rows.every(r => selectedRows.has(r.original.id))}
          onChange={() => toggleAll(table.getRowModel().rows.map(r => r.original))}
        />
      ),
      cell: ({ row }) => (
        <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer rounded border-border"
          checked={selectedRows.has(row.original.id)}
          onChange={() => toggleRow(row.original.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      size: 32,
    },
    // ── Month / Date ──────────────────────────────────────────────────
    {
      accessorKey: "month",
      header: t.date,
      cell: ({ row }) => {
        const m = row.original.month;
        const y = row.original.year;
        if (!m) return <span className="text-muted-foreground text-xs">—</span>;
        const monthName = isRTL ? MONTH_NAMES_AR[m - 1] : MONTH_NAMES_EN[m - 1];
        return (
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-semibold text-foreground">{monthName}</span>
            <span className="text-[10px] text-muted-foreground">{y}</span>
          </div>
        );
      },
    },
    // ── Partner ID ────────────────────────────────────────────────────
    {
      accessorKey: "partner_id",
      header: t.partner,
      cell: ({ getValue }) => (
        <span className="text-xs font-mono font-semibold text-muted-foreground">
          {getValue() as string}
        </span>
      ),
    },
    // ── Client Name ───────────────────────────────────────────────────
    {
      accessorKey: "name",
      header: t.client,
      cell: ({ getValue }) => (
        <span className="font-medium text-sm max-w-[180px] block">{getValue() as string}</span>
      ),
    },
    // ── Salesperson ───────────────────────────────────────────────────
    {
      accessorKey: "salesperson_name",
      header: t.salesperson,
      cell: ({ row }) => {
        const name = row.original.salesperson_name;
        const code = row.original.salesperson_code;
        if (!name && !code) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <div className="flex flex-col">
            <span className="text-sm font-medium">{name || code}</span>
            {name && code && (
              <span className="text-[10px] text-muted-foreground font-mono">{code}</span>
            )}
          </div>
        );
      },
    },
    // ── Product Name ──────────────────────────────────────────────────
    {
      accessorKey: "top_product_name",
      filterFn: (row, columnId, filterValue) => {
        if (filterValue == null || filterValue === "") return true;
        const arr = Array.isArray(filterValue) ? (filterValue as string[]) : [String(filterValue)];
        if (arr.length === 0) return true;
        const cell = row.getValue(columnId) as string | null;
        if (!cell) return false;
        return arr.includes(cell);
      },
      header: t.product,
      cell: ({ getValue }) => {
        const product = getValue() as string | null;
        if (!product) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 text-xs font-semibold">
            {product}
          </span>
        );
      },
    },
    // ── Import: category / pricelist / invoice (meter lines, this month) ─
    {
      accessorKey: "order_import_category",
      header: t.importCategory,
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        if (!v) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <span className="text-xs max-w-[200px] line-clamp-2" title={v}>
            {v}
          </span>
        );
      },
    },
    {
      accessorKey: "order_import_pricelist",
      header: t.importPricelist,
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        if (!v) return <span className="text-muted-foreground text-xs">—</span>;
        return <span className="text-xs max-w-[140px] truncate" title={v}>{v}</span>;
      },
    },
    {
      accessorKey: "order_import_invoice",
      header: t.importInvoice,
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        if (!v) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex max-w-[120px] items-center gap-1 rounded px-1 py-0.5 text-xs font-mono text-start hover:bg-muted/60"
                title={isRTL ? "اضغط لعرض كامل النص" : "Click to show full text"}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span className="truncate">{v}</span>
                <Expand className="h-3 w-3 shrink-0 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-w-[420px]">
              <p className="text-xs font-mono break-words leading-6">{v}</p>
            </PopoverContent>
          </Popover>
        );
      },
    },
    // ── Meters ────────────────────────────────────────────────────────
    {
      accessorKey: "total_meters",
      header: t.meters,
      cell: ({ getValue }) => {
        const meters = getValue() as number;
        if (!meters) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <span className="text-sm font-bold tabular-nums text-foreground">
            {formatNumber(meters)} {isRTL ? "متر" : "meters"}
          </span>
        );
      },
    },
    // ── Invoice Total ─────────────────────────────────────────────────
    {
      accessorKey: "total_revenue",
      header: isRTL ? "الإجمالي (EGP)" : "Revenue (EGP)",
      cell: ({ getValue }) => {
        const rev = getValue() as number;
        if (!rev) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <span className="text-sm font-semibold tabular-nums text-green-700 dark:text-green-400">
            {rev.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </span>
        );
      },
    },
    // ── Customer Type ─────────────────────────────────────────────────
    {
      accessorKey: "customer_type",
      filterFn: (row, columnId, filterValue) => {
        if (filterValue == null || filterValue === "") return true;
        const arr = Array.isArray(filterValue) ? (filterValue as string[]) : [String(filterValue)];
        if (arr.length === 0) return true;
        const cell = row.getValue(columnId) as string | null;
        if (!cell) return false;
        return arr.includes(cell);
      },
      header: isRTL ? "نوع العميل" : "Cust. Type",
      cell: ({ getValue }) => {
        const ct = getValue() as string | null;
        if (!ct) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-700">
            {ct}
          </span>
        );
      },
    },
    // ── Cartelah ──────────────────────────────────────────────────────
    {
      accessorKey: "cartela_count",
      header: t.cartela,
      cell: ({ row }) => {
        const qty        = row.original.cartela_count || row.original.top_product_cartela;
        const crossMonth = row.original.kartela_cross_month;
        const km         = row.original.kartela_month;
        const ky         = row.original.kartela_year;

        if (!qty) return <span className="text-muted-foreground text-xs">—</span>;

        const monthLabel = km
          ? `${isRTL ? MONTH_NAMES_AR[km - 1] : MONTH_NAMES_EN[km - 1]} ${ky ?? ""}`
          : null;

        return (
          <div className="flex flex-col gap-0.5 items-start">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${
              crossMonth
                ? "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700"
                : "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-700"
            }`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {qty}
            </span>
            {monthLabel && (
              <span className="text-[10px] text-muted-foreground">
                {crossMonth
                  ? (isRTL ? `من ${monthLabel}` : `from ${monthLabel}`)
                  : monthLabel}
              </span>
            )}
          </div>
        );
      },
    },
    // ── Level ─────────────────────────────────────────────────────────
    {
      accessorKey: "level",
      header: t.level,
      cell: ({ getValue }) => {
        const level = getValue() as OrderLevel;
        return (
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${getLevelBadgeColor(level)}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {levelLabels[level]}
          </span>
        );
      },
    },
    // ── Status ────────────────────────────────────────────────────────
    {
      accessorKey: "current_status",
      header: t.status,
      cell: ({ row }) => (
        <ClientStatusSelect
          clientId={row.original.id}
          clientName={row.original.name}
          currentStatus={row.original.current_status}
          locale={locale}
          onUpdated={(newStatus) => {
            setClients((prev) =>
              prev.map((c) => (c.id === row.original.id ? { ...c, current_status: newStatus } : c))
            );
            setLogCache((p) => {
              const n = { ...p };
              delete n[row.original.id];
              return n;
            });
            setExpanded((p) => ({ ...p, [row.original.id]: true }));
            invalidateClientCache();
            fetchClients(true);
          }}
        />
      ),
    },
    // ── Actions ───────────────────────────────────────────────────────
    {
      id: "actions",
      header: t.actions,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSelectedClient(row.original); setDialogType("note"); }}
            className="h-7 px-2 text-xs"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
    // Hidden column: multiselect client IDs (not shown; drives row filter)
    {
      id: "_clientIds",
      accessorFn: (row) => row.id,
      header: () => null,
      cell: () => null,
      size: 0,
      enableSorting: false,
      filterFn: (row, _columnId, filterValue) => {
        if (filterValue == null || filterValue === "") return true;
        const arr = Array.isArray(filterValue) ? (filterValue as string[]) : [String(filterValue)];
        if (arr.length === 0) return true;
        return arr.includes(row.original.id);
      },
    },
  ];

  const table = useReactTable({
    data: clients,
    columns,
    state: { sorting, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 20 },
      columnVisibility: { _clientIds: false },
    },
  });

  const metersByProduct = useMemo(() => {
    const m = new Map<string, number>();
    clients.forEach((c) => {
      const n = c.top_product_name;
      if (!n) return;
      m.set(n, (m.get(n) || 0) + c.total_meters);
    });
    return m;
  }, [clients]);

  const productOptions = useMemo(() => {
    const names = Array.from(new Set(clients.map((c) => c.top_product_name).filter(Boolean))) as string[];
    return names.sort((a, b) => (metersByProduct.get(b) || 0) - (metersByProduct.get(a) || 0));
  }, [clients, metersByProduct]);

  const clientOptions = useMemo(
    () =>
      [...clients]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
        .map((c) => ({ id: c.id, name: c.name, partner_id: c.partner_id })),
    [clients],
  );

  const typeOptions = allowedCustomerTypesList();

  const colFilterArr = (columnId: string) => {
    const v = table.getColumn(columnId)?.getFilterValue();
    if (v == null || v === "") return [] as string[];
    return Array.isArray(v) ? (v as string[]) : [String(v)];
  };
  const activeProdArr = colFilterArr("top_product_name");
  const activeTypeArr = colFilterArr("customer_type");
  const activeClientArr = colFilterArr("_clientIds");

  const prodSummary =
    activeProdArr.length === 0
      ? isRTL ? "كل المنتجات" : "All Products"
      : activeProdArr.length === 1
        ? activeProdArr[0]
        : isRTL
          ? `${activeProdArr.length} منتجات`
          : `${activeProdArr.length} products`;

  const typeSummary =
    activeTypeArr.length === 0
      ? isRTL ? "كل الأنواع" : "All Types"
      : activeTypeArr.length === 1
        ? activeTypeArr[0]
        : isRTL
          ? `${activeTypeArr.length} أنواع`
          : `${activeTypeArr.length} types`;

  const clientSummary =
    activeClientArr.length === 0
      ? isRTL ? "كل العملاء" : "All Clients"
      : activeClientArr.length === 1
        ? clientOptions.find((c) => c.id === activeClientArr[0])?.name ?? activeClientArr[0]
        : isRTL
          ? `${activeClientArr.length} عملاء`
          : `${activeClientArr.length} clients`;

  const handleExport = async () => {
    const { utils, writeFile } = await import("xlsx");
    const rows = table.getFilteredRowModel().rows.map((r) => r.original);
    const ws = utils.json_to_sheet(
      rows.map((c) => ({
        [t.date]: c.month ? `${isRTL ? MONTH_NAMES_AR[c.month - 1] : MONTH_NAMES_EN[c.month - 1]} ${c.year}` : "",
        [t.partner]: c.partner_id,
        [t.client]: c.name,
        [isRTL ? "نوع العميل" : "Customer Type"]: c.customer_type || "",
        [t.salesperson]: c.salesperson_name || c.salesperson_code || "",
        [t.product]: c.top_product_name || "",
        [t.importCategory]: c.order_import_category || "",
        [t.importPricelist]: c.order_import_pricelist || "",
        [t.importInvoice]: c.order_import_invoice || "",
        [t.meters]: c.total_meters,
        [isRTL ? "الإجمالي (EGP)" : "Revenue (EGP)"]: c.total_revenue || 0,
        [isRTL ? "عدد الطلبات" : "Orders"]: c.order_count || 0,
        [t.cartela]: c.top_product_cartela > 0 ? c.top_product_cartela : c.cartela_count,
        [t.level]: levelLabels[c.level],
        [t.status]: statusLabels[c.current_status],
      }))
    );
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Clients");
    writeFile(wb, "clients.xlsx");
  };

  const toggleProductFilter = (name: string) => {
    const col = table.getColumn("top_product_name");
    const v = col?.getFilterValue();
    const cur = v == null || v === "" ? [] : Array.isArray(v) ? (v as string[]) : [String(v)];
    const next = cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name];
    col?.setFilterValue(next.length ? next : undefined);
  };

  const toggleTypeFilter = (ct: string) => {
    const col = table.getColumn("customer_type");
    const v = col?.getFilterValue();
    const cur = v == null || v === "" ? [] : Array.isArray(v) ? (v as string[]) : [String(v)];
    const next = cur.includes(ct) ? cur.filter((x) => x !== ct) : [...cur, ct];
    col?.setFilterValue(next.length ? next : undefined);
  };

  const toggleClientFilter = (id: string) => {
    const col = table.getColumn("_clientIds");
    const v = col?.getFilterValue();
    const cur = v == null || v === "" ? [] : Array.isArray(v) ? (v as string[]) : [String(v)];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    col?.setFilterValue(next.length ? next : undefined);
  };

  const productTypeMobileExtra = (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        {isRTL ? "من الجدول" : "Table filters"}
      </p>
      <Popover open={clientFilterOpen} onOpenChange={setClientFilterOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={clientFilterOpen} className="w-full h-9 text-xs justify-between font-normal">
            <span className="truncate">{clientSummary}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ms-1" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(100vw-2rem,20rem)] p-0" align="start">
          <Command>
            <CommandInput placeholder={isRTL ? "ابحث عن عميل..." : "Search client..."} className="text-xs h-8" />
            <CommandList>
              <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">{isRTL ? "لا توجد نتائج" : "No results"}</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__all_clients__"
                  onSelect={() => table.getColumn("_clientIds")?.setFilterValue(undefined)}
                  className="text-xs"
                >
                  <Check className={`h-3.5 w-3.5 mr-2 ${activeClientArr.length === 0 ? "opacity-100" : "opacity-0"}`} />
                  {isRTL ? "كل العملاء" : "All Clients"}
                </CommandItem>
                {clientOptions.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`${c.name} ${c.partner_id}`}
                    onSelect={() => toggleClientFilter(c.id)}
                    className="text-xs"
                  >
                    <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${activeClientArr.includes(c.id) ? "opacity-100" : "opacity-0"}`} />
                    <span className="truncate">{c.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Popover open={prodOpen} onOpenChange={setProdOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={prodOpen} className="w-full h-9 text-xs justify-between font-normal">
            <span className="truncate">{prodSummary}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ms-1" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(100vw-2rem,20rem)] p-0" align="start">
          <Command>
            <CommandInput placeholder={isRTL ? "ابحث عن منتج..." : "Search product..."} className="text-xs h-8" />
            <CommandList>
              <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">{isRTL ? "لا توجد نتائج" : "No results"}</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__all__"
                  onSelect={() => table.getColumn("top_product_name")?.setFilterValue(undefined)}
                  className="text-xs"
                >
                  <Check className={`h-3.5 w-3.5 mr-2 ${activeProdArr.length === 0 ? "opacity-100" : "opacity-0"}`} />
                  {isRTL ? "كل المنتجات" : "All Products"}
                </CommandItem>
                {productOptions.map((p) => (
                  <CommandItem
                    key={p}
                    value={p}
                    onSelect={() => toggleProductFilter(p)}
                    className="text-xs"
                  >
                    <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${activeProdArr.includes(p) ? "opacity-100" : "opacity-0"}`} />
                    <span className="truncate">{p}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Popover open={typeOpen} onOpenChange={setTypeOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={typeOpen} className="w-full h-9 text-xs justify-between font-normal">
            <span className="truncate">{typeSummary}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ms-1" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(100vw-2rem,20rem)] p-0" align="start">
          <Command>
            <CommandInput placeholder={isRTL ? "ابحث..." : "Search..."} className="text-xs h-8" />
            <CommandList>
              <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">{isRTL ? "لا توجد نتائج" : "No results"}</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__all__"
                  onSelect={() => table.getColumn("customer_type")?.setFilterValue(undefined)}
                  className="text-xs"
                >
                  <Check className={`h-3.5 w-3.5 mr-2 ${activeTypeArr.length === 0 ? "opacity-100" : "opacity-0"}`} />
                  {isRTL ? "كل الأنواع" : "All Types"}
                </CommandItem>
                {typeOptions.map((ct) => (
                  <CommandItem
                    key={ct}
                    value={ct}
                    onSelect={() => toggleTypeFilter(ct)}
                    className="text-xs"
                  >
                    <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${activeTypeArr.includes(ct) ? "opacity-100" : "opacity-0"}`} />
                    {ct}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div className="space-y-3 md:space-y-6">
      <PageBack locale={locale} fallbackHref="/dashboard" />
      {/* Header */}
      <div className="flex items-start justify-between gap-2 md:gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg md:text-2xl font-bold">{t.title}</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-0.5 md:mt-1">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              dataCache.invalidate("clients_v10:");
              dataCache.invalidate("clients_v11:");
              fetchClients(true);
            }}
            className="gap-1.5 md:gap-2 h-8 text-xs md:text-sm px-2 md:px-3"
          >
            <RefreshCw className="h-3.5 w-3.5 md:h-4 md:w-4" />
            {isRTL ? "تحديث" : "Refresh"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5 md:gap-2 h-8 text-xs md:text-sm px-2 md:px-3">
            <Download className="h-3.5 w-3.5 md:h-4 md:w-4" />
            {t.export}
          </Button>
        </div>
      </div>

      <FilterBar locale={locale} showStatus showLevel showSalesperson mobileDrawerExtra={productTypeMobileExtra} />

      {selectedRows.size > 0 && (
        <div className="md:hidden flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/10 px-2 py-1.5 text-xs font-semibold text-primary">
          <span>
            {selectedRows.size} {isRTL ? "محدد" : "selected"}
          </span>
          <button type="button" className="opacity-70 hover:opacity-100" onClick={() => setSelectedRows(new Set())}>
            ✕
          </button>
        </div>
      )}

      {/* Clients + Product + Customer type — desktop / tablet (multiselect) */}
      <div className="hidden md:flex items-center gap-2 flex-wrap">
        <Popover open={clientFilterOpen} onOpenChange={setClientFilterOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" aria-expanded={clientFilterOpen} className="w-44 h-8 text-xs justify-between font-normal">
              <span className="truncate">{clientSummary}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command>
              <CommandInput placeholder={isRTL ? "ابحث عن عميل..." : "Search client..."} className="text-xs h-8" />
              <CommandList>
                <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">{isRTL ? "لا توجد نتائج" : "No results"}</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="__all_clients__"
                    onSelect={() => table.getColumn("_clientIds")?.setFilterValue(undefined)}
                    className="text-xs"
                  >
                    <Check className={`h-3.5 w-3.5 mr-2 ${activeClientArr.length === 0 ? "opacity-100" : "opacity-0"}`} />
                    {isRTL ? "كل العملاء" : "All Clients"}
                  </CommandItem>
                  {clientOptions.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`${c.name} ${c.partner_id}`}
                      onSelect={() => toggleClientFilter(c.id)}
                      className="text-xs"
                    >
                      <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${activeClientArr.includes(c.id) ? "opacity-100" : "opacity-0"}`} />
                      <span className="truncate">{c.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Popover open={prodOpen} onOpenChange={setProdOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" aria-expanded={prodOpen} className="w-44 h-8 text-xs justify-between font-normal">
              <span className="truncate">{prodSummary}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder={isRTL ? "ابحث عن منتج..." : "Search product..."} className="text-xs h-8" />
              <CommandList>
                <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">{isRTL ? "لا توجد نتائج" : "No results"}</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="__all__"
                    onSelect={() => table.getColumn("top_product_name")?.setFilterValue(undefined)}
                    className="text-xs"
                  >
                    <Check className={`h-3.5 w-3.5 mr-2 ${activeProdArr.length === 0 ? "opacity-100" : "opacity-0"}`} />
                    {isRTL ? "كل المنتجات" : "All Products"}
                  </CommandItem>
                  {productOptions.map((p) => (
                    <CommandItem
                      key={p}
                      value={p}
                      onSelect={() => toggleProductFilter(p)}
                      className="text-xs"
                    >
                      <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${activeProdArr.includes(p) ? "opacity-100" : "opacity-0"}`} />
                      <span className="truncate">{p}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Popover open={typeOpen} onOpenChange={setTypeOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" aria-expanded={typeOpen} className="w-36 h-8 text-xs justify-between font-normal">
              <span className="truncate">{typeSummary}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-0" align="start">
            <Command>
              <CommandInput placeholder={isRTL ? "ابحث..." : "Search..."} className="text-xs h-8" />
              <CommandList>
                <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">{isRTL ? "لا توجد نتائج" : "No results"}</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="__all__"
                    onSelect={() => table.getColumn("customer_type")?.setFilterValue(undefined)}
                    className="text-xs"
                  >
                    <Check className={`h-3.5 w-3.5 mr-2 ${activeTypeArr.length === 0 ? "opacity-100" : "opacity-0"}`} />
                    {isRTL ? "كل الأنواع" : "All Types"}
                  </CommandItem>
                  {typeOptions.map((ct) => (
                    <CommandItem
                      key={ct}
                      value={ct}
                      onSelect={() => toggleTypeFilter(ct)}
                      className="text-xs"
                    >
                      <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${activeTypeArr.includes(ct) ? "opacity-100" : "opacity-0"}`} />
                      {ct}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {selectedRows.size > 0 && (
          <span className="text-xs px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary font-semibold">
            {selectedRows.size} {isRTL ? "محدد" : "selected"}
            <button type="button" className="ms-2 opacity-60 hover:opacity-100" onClick={() => setSelectedRows(new Set())}>
              ✕
            </button>
          </span>
        )}
      </div>

      {/* Error banner */}
      {fetchError && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
          <p className="font-semibold mb-1">{isRTL ? "خطأ في تحميل البيانات:" : "Error loading data:"}</p>
          <p className="font-mono text-xs break-all">{fetchError}</p>
        </div>
      )}
      {partialLoadInfo && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3">
          <span>{partialLoadInfo}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => fetchClients(true)}
          >
            {isRTL ? "إعادة التحميل" : "Reload"}
          </Button>
        </div>
      )}

      {/* Search + Table */}
      <Card>
        <CardContent className="p-0">
          {/* Search + count summary */}
          <div className="p-2 md:p-4 border-b border-border flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
            <div className="relative w-full md:max-w-sm md:flex-1 min-w-0">
              <Search className={`absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground ${isRTL ? "right-2.5 md:right-3" : "left-2.5 md:left-3"}`} />
              <Input
                placeholder={t.search}
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className={cn("h-8 md:h-10 text-sm", isRTL ? "pr-8 md:pr-9" : "pl-8 md:pl-9")}
              />
            </div>

            {!loading && (
              <div className="flex flex-wrap items-center gap-1.5 md:gap-2 shrink-0">
                <span className="inline-flex flex-wrap items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 rounded-md md:rounded-lg bg-primary/10 border border-primary/20 text-[10px] md:text-xs font-semibold text-primary leading-tight">
                  <span className="whitespace-normal">{isRTL ? "إجمالي القاعدة:" : "Total in DB:"}</span>
                  <span className="text-sm md:text-base font-bold tabular-nums">{clients.length.toLocaleString()}</span>
                  <span>{isRTL ? "عميل" : "clients"}</span>
                </span>

                {table.getFilteredRowModel().rows.length !== clients.length && (
                  <span className="inline-flex flex-wrap items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 rounded-md md:rounded-lg bg-orange-50 border border-orange-200 text-[10px] md:text-xs font-semibold text-orange-700 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-300 leading-tight">
                    <span>{isRTL ? "بعد التصفية:" : "Filtered:"}</span>
                    <span className="text-sm md:text-base font-bold tabular-nums">
                      {table.getFilteredRowModel().rows.length.toLocaleString()}
                    </span>
                  </span>
                )}
                {loadingMore && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 rounded-md md:rounded-lg bg-blue-50 border border-blue-200 text-[10px] md:text-xs font-semibold text-blue-700 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-300">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    {isRTL ? "تحميل باقي العملاء..." : "Loading remaining clients..."}
                  </span>
                )}
              </div>
            )}
          </div>


          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 border border-border/80 rounded-lg overflow-hidden">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="bg-muted/40">
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/80 border-e border-border/70 last:border-e-0"
                      >
                        {header.isPlaceholder ? null : (
                          <div
                            className={`flex items-center gap-1 ${header.column.getCanSort() ? "cursor-pointer select-none hover:text-foreground" : ""}`}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getCanSort() && (
                              <span className="opacity-50">
                                {header.column.getIsSorted() === "asc" ? (
                                  <ChevronUp className="h-3.5 w-3.5" />
                                ) : header.column.getIsSorted() === "desc" ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronsUpDown className="h-3.5 w-3.5" />
                                )}
                              </span>
                            )}
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {loading ? (
                  Array(10).fill(0).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array(14).fill(0).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-muted rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : table.getRowModel().rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="text-center py-12 text-muted-foreground text-sm">
                      {isRTL ? "لا توجد بيانات" : "No data available"}
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row, i) => (
                    <>
                      <motion.tr
                        key={row.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.12 }}
                        className={`cursor-pointer transition-colors ${expanded[row.original.id] ? "bg-muted/25" : i % 2 === 0 ? "bg-background" : "bg-muted/10"} hover:bg-muted/30`}
                        onClick={() => toggleExpand(row.original.id)}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-4 py-3 border-b border-border/80 border-e border-border/70 last:border-e-0 align-top" onClick={cell.column.id === "select" ? (e) => e.stopPropagation() : undefined}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </motion.tr>
                      <AnimatePresence>
                        {expanded[row.original.id] && (
                          <motion.tr key={`exp_${row.id}`}
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          >
                            <td colSpan={columns.length} className="p-0 border-b border-border/50">
                              <div className="bg-muted/10 border-t border-dashed border-border/60 px-6 py-4">
                                {/* Notes section */}
                                {row.original.notes && (
                                  <div className="mb-3 flex items-start gap-2 p-2.5 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800">
                                    <StickyNote className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                                    <p className="text-sm text-yellow-900 dark:text-yellow-200">{row.original.notes}</p>
                                  </div>
                                )}
                                {/* Activity log */}
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                                    <History className="h-3.5 w-3.5" />
                                    {isRTL ? "سجل النشاط" : "Activity Log"}
                                  </p>
                                  {logLoading[row.original.id] ? (
                                    <div className="flex items-center gap-2 py-3">
                                      <div className="h-3 w-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                      <span className="text-xs text-muted-foreground">{isRTL ? "جاري التحميل..." : "Loading..."}</span>
                                    </div>
                                  ) : !logCache[row.original.id]?.length ? (
                                    <p className="text-xs text-muted-foreground py-2">{isRTL ? "لا يوجد نشاط مسجل" : "No activity recorded yet"}</p>
                                  ) : (
                                    <div className="space-y-1.5 max-h-52 overflow-y-auto">
                                      {logCache[row.original.id].map((entry) => (
                                        <div key={entry.id} className="flex items-start gap-2 p-2 rounded-lg bg-background border border-border/60 text-xs">
                                          {entry.type === "STATUS_CHANGE" ? (
                                            <ArrowRight className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                                          ) : (
                                            <MessageSquare className="h-3.5 w-3.5 text-purple-500 shrink-0 mt-0.5" />
                                          )}
                                          <div className="flex-1 min-w-0">
                                            {entry.type === "STATUS_CHANGE" ? (
                                              <span className="font-medium">
                                                {(isRTL ? STATUS_LABELS_AR : STATUS_LABELS_EN)[entry.metadata?.old_status] ?? entry.metadata?.old_status}
                                                {" → "}
                                                {(isRTL ? STATUS_LABELS_AR : STATUS_LABELS_EN)[entry.metadata?.new_status] ?? entry.metadata?.new_status}
                                                {entry.metadata?.reason && <span className="text-muted-foreground ms-1">— {entry.metadata.reason}</span>}
                                              </span>
                                            ) : (
                                              <span className="text-muted-foreground">{entry.metadata?.note ?? (isRTL ? "تم إضافة ملاحظة" : "Note added")}</span>
                                            )}
                                          </div>
                                          <div className="shrink-0 text-right text-muted-foreground">
                                            <div className="font-medium text-foreground">{entry.user_name}</div>
                                            <div>{new Date(entry.created_at).toLocaleDateString(isRTL ? "ar-EG" : "en-US", { year: "numeric", month: "short", day: "numeric" })}</div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm text-muted-foreground">
            <div>
              {table.getFilteredRowModel().rows.length === 0 ? (
                <span className="font-medium text-foreground">0</span>
              ) : (
                <>
                  {t.showing}{" "}
                  <span className="font-medium text-foreground">
                    {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}
                  </span>{" "}
                  -{" "}
                  <span className="font-medium text-foreground">
                    {Math.min(
                      (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                      table.getFilteredRowModel().rows.length
                    )}
                  </span>{" "}
                  {t.of}{" "}
                  <span className="font-medium text-foreground">
                    {table.getFilteredRowModel().rows.length}
                  </span>
                </>
              )}{" "}
              {t.rows}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="h-8"
              >
                <ChevronLeft className="h-4 w-4" />
                {!isRTL && <span>{t.prev}</span>}
                {isRTL && <span>{t.next}</span>}
              </Button>
              <span className="text-xs">
                {t.page} {table.getState().pagination.pageIndex + 1} {t.of}{" "}
                {table.getPageCount()}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="h-8"
              >
                {!isRTL && <span>{t.next}</span>}
                {isRTL && <span>{t.prev}</span>}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      {selectedClient && dialogType === "note" && (
        <AddNoteDialog
          client={selectedClient}
          locale={locale}
          onClose={() => { setSelectedClient(null); setDialogType(null); }}
          onSuccess={() => {
            invalidateClientCache();
            setLogCache((p) => { const n = {...p}; delete n[selectedClient.id]; return n; });
            fetchClients(true);
            setSelectedClient(null); setDialogType(null);
          }}
        />
      )}
    </div>
  );
}
