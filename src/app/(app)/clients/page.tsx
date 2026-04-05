"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  Edit3,
  History,
  MessageSquare,
  StickyNote,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check } from "lucide-react";
import { FilterBar } from "@/components/shared/FilterBar";
import { UpdateStatusDialog } from "@/components/clients/UpdateStatusDialog";
import { AddNoteDialog } from "@/components/clients/AddNoteDialog";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";
import { getLevelBadgeColor, getStatusColor, formatNumber } from "@/lib/utils";
import { dataCache } from "@/lib/dataCache";
import type { ClientStatus, OrderLevel } from "@/types/database";

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
}

export default function ClientsPage() {
  const { locale, filters, salespersonId, currentUser } = useStore();
  const isRTL = locale === "ar";
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState(() => searchParams.get("search") ?? "");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
    const cf: ColumnFiltersState = [];
    const product = searchParams.get("product");
    if (product) cf.push({ id: "top_product_name", value: product });
    return cf;
  });
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null);
  const [dialogType, setDialogType] = useState<"status" | "note" | "history" | null>(null);
  const didApplyUrlParams = useRef(false);

  // Apply URL search params once on first load
  useEffect(() => {
    if (didApplyUrlParams.current) return;
    didApplyUrlParams.current = true;
    const search  = searchParams.get("search");
    const product = searchParams.get("product");
    if (search)  setGlobalFilter(search);
    if (product) setColumnFilters((cf) => {
      const without = cf.filter((f) => f.id !== "top_product_name");
      return [...without, { id: "top_product_name", value: product }];
    });
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
    const supabase = createClient();
    const now = new Date();
    const selectedMonth = filters.selectedMonth ?? (now.getMonth() + 1);
    const selectedYear  = filters.selectedYear  ?? now.getFullYear();
    const spFilter      = salespersonId || filters.selectedSalesperson;
    const cacheKey = `clients_v9:${selectedYear}-${selectedMonth}-${spFilter || "all"}`;

    // ── Global session cache hit → render instantly ──────────────────────
    if (!forceRefresh) {
      const cached = dataCache.get<ClientRow[]>(cacheKey);
      if (cached) {
        setClients(cached);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    try {
      const PAGE_SIZE = 1000;

      // Helper: sequential page fetcher — logs errors instead of silently swallowing them
      const fetchPages = async (
        table: string,
        cols: string,
        applyFilters: (q: any) => any
      ): Promise<{ rows: any[]; error: string | null }> => {
        const all: any[] = [];
        let offset = 0;
        while (true) {
          const { data, error } = await applyFilters(
            supabase.from(table).select(cols)
          ).range(offset, offset + PAGE_SIZE - 1);
          if (error) {
            console.error(`[fetchPages] ${table} error:`, error.message);
            return { rows: all, error: error.message };
          }
          if (!data?.length) break;
          all.push(...data);
          if (data.length < PAGE_SIZE) break;
          offset += PAGE_SIZE;
        }
        return { rows: all, error: null };
      };

      const VIEW_COLS = "client_id, partner_id, client_name, current_status, total_meters, total_revenue, order_count, customer_type, level, cartela_count, top_product_cartela, top_product_name, salesperson_id, salesperson_name, salesperson_code, month, year, kartela_month, kartela_year, kartela_cross_month";
      const wantInactive = filters.selectedLevel === "INACTIVE";

      // ── 1. Fetch in parallel: view rows + salespersons + (if inactive: all clients, else: count only) ──
      const clientCountQ = (() => {
        let q = supabase.from("clients").select("id", { count: "exact", head: true });
        if (spFilter) q = q.eq("salesperson_id", spFilter);
        return q;
      })();
      const inactiveClientsQ = wantInactive
        ? fetchPages("clients", "id, partner_id, name, salesperson_id, current_status, customer_type", (q) => {
            let qq = q.neq("customer_type", "الشركات الشقيقة");
            if (spFilter) return qq.eq("salesperson_id", spFilter);
            return qq;
          })
        : Promise.resolve({ rows: [], error: null });

      const [viewResult, spData, clientCountResult, inactiveClientsResult] = await Promise.all([
        fetchPages("client_monthly_metrics", VIEW_COLS, (q) => {
          let qq = q.eq("month", selectedMonth).eq("year", selectedYear)
                    .neq("customer_type", "الشركات الشقيقة");
          if (spFilter) qq = qq.eq("salesperson_id", spFilter);
          return qq;
        }),
        supabase.from("salespersons").select("id, name, code"),
        clientCountQ,
        inactiveClientsQ,
      ]);

      let viewRows = viewResult.rows;

      // Safety net: if view returned 0 rows → retry once
      if (viewRows.length === 0 && (clientCountResult as any)?.count > 50 && !viewResult.error) {
        const { data: retryData } = await supabase
          .from("client_monthly_metrics").select(VIEW_COLS)
          .eq("month", selectedMonth).eq("year", selectedYear).range(0, 29999);
        viewRows = retryData || [];
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
        });
      });

      // Step B: dormant clients — only fetched when user explicitly filters for INACTIVE
      if (wantInactive) {
        inactiveClientsResult.rows.forEach((c: any) => {
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
          });
        });
      }

      // Batch-fetch notes + latest current_status from clients table
      const allClientIds = combined.map((c) => c.id);
      let notesMap: Record<string, { notes: string | null; current_status: string }> = {};
      if (allClientIds.length > 0) {
        const chunks = [];
        for (let i = 0; i < allClientIds.length; i += 500) chunks.push(allClientIds.slice(i, i + 500));
        for (const chunk of chunks) {
          const { data: clientRows } = await supabase
            .from("clients").select("id, notes, current_status").in("id", chunk);
          (clientRows ?? []).forEach((c: any) => { notesMap[c.id] = { notes: c.notes ?? null, current_status: c.current_status }; });
        }
      }
      combined.forEach((c) => {
        const fresh = notesMap[c.id];
        if (fresh) {
          c.notes = fresh.notes;
          if (fresh.current_status) c.current_status = fresh.current_status as ClientStatus;
        }
      });

      combined.sort((a, b) => b.total_meters - a.total_meters);
      dataCache.set(cacheKey, combined);
      setClients(combined);

    } catch (err: any) {
      setFetchError(err?.message || "Network error — check Supabase connection");
    }

    setLoading(false);
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
  const [prodOpen,    setProdOpen]    = useState(false);
  const [typeOpen,    setTypeOpen]    = useState(false);

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
    dataCache.invalidate("clients_v9:");
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
      cell: ({ getValue }) => {
        const status = getValue() as ClientStatus;
        return (
          <span
            className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(status)}`}
          >
            {statusLabels[status]}
          </span>
        );
      },
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
            onClick={() => { setSelectedClient(row.original); setDialogType("status"); }}
            className="h-7 px-2 text-xs"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </Button>
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
    initialState: { pagination: { pageSize: 20 } },
  });

  const handleExport = async () => {
    const { utils, writeFile } = await import("xlsx");
    const ws = utils.json_to_sheet(
      clients.map((c) => ({
        [t.date]: c.month ? `${isRTL ? MONTH_NAMES_AR[c.month - 1] : MONTH_NAMES_EN[c.month - 1]} ${c.year}` : "",
        [t.partner]: c.partner_id,
        [t.client]: c.name,
        [isRTL ? "نوع العميل" : "Customer Type"]: c.customer_type || "",
        [t.salesperson]: c.salesperson_name || c.salesperson_code || "",
        [t.product]: c.top_product_name || "",
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { dataCache.invalidate("clients_v9:"); fetchClients(true); }} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            {isRTL ? "تحديث" : "Refresh"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
            <Download className="h-4 w-4" />
            {t.export}
          </Button>
        </div>
      </div>

      <FilterBar
        locale={locale}
        showStatus
        showLevel
        showSalesperson
      />

      {/* Product + Customer Type filters — searchable */}
      {(() => {
        const productOptions  = Array.from(new Set(clients.map(c => c.top_product_name).filter(Boolean))).sort() as string[];
        const typeOptions     = Array.from(new Set(clients.map(c => c.customer_type).filter(Boolean))).sort() as string[];
        const activeProd      = (table.getColumn("top_product_name")?.getFilterValue() as string) ?? "";
        const activeType      = (table.getColumn("customer_type")?.getFilterValue() as string) ?? "";
        return (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Searchable Product filter */}
            <Popover open={prodOpen} onOpenChange={setProdOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={prodOpen}
                  className="w-44 h-8 text-xs justify-between font-normal">
                  <span className="truncate">{activeProd || (isRTL ? "كل المنتجات" : "All Products")}</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-0" align="start">
                <Command>
                  <CommandInput placeholder={isRTL ? "ابحث عن منتج..." : "Search product..."} className="text-xs h-8" />
                  <CommandList>
                    <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
                      {isRTL ? "لا توجد نتائج" : "No results"}
                    </CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="__all__" onSelect={() => { table.getColumn("top_product_name")?.setFilterValue(undefined); setProdOpen(false); }} className="text-xs">
                        <Check className={`h-3.5 w-3.5 mr-2 ${!activeProd ? "opacity-100" : "opacity-0"}`} />
                        {isRTL ? "كل المنتجات" : "All Products"}
                      </CommandItem>
                      {productOptions.map((p) => (
                        <CommandItem key={p} value={p}
                          onSelect={() => { table.getColumn("top_product_name")?.setFilterValue(activeProd === p ? undefined : p); setProdOpen(false); }}
                          className="text-xs">
                          <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${activeProd === p ? "opacity-100" : "opacity-0"}`} />
                          <span className="truncate">{p}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Searchable Customer Type filter */}
            <Popover open={typeOpen} onOpenChange={setTypeOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={typeOpen}
                  className="w-36 h-8 text-xs justify-between font-normal">
                  <span className="truncate">{activeType || (isRTL ? "كل الأنواع" : "All Types")}</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-44 p-0" align="start">
                <Command>
                  <CommandInput placeholder={isRTL ? "ابحث..." : "Search..."} className="text-xs h-8" />
                  <CommandList>
                    <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
                      {isRTL ? "لا توجد نتائج" : "No results"}
                    </CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="__all__" onSelect={() => { table.getColumn("customer_type")?.setFilterValue(undefined); setTypeOpen(false); }} className="text-xs">
                        <Check className={`h-3.5 w-3.5 mr-2 ${!activeType ? "opacity-100" : "opacity-0"}`} />
                        {isRTL ? "كل الأنواع" : "All Types"}
                      </CommandItem>
                      {typeOptions.map((ct) => (
                        <CommandItem key={ct} value={ct}
                          onSelect={() => { table.getColumn("customer_type")?.setFilterValue(activeType === ct ? undefined : ct); setTypeOpen(false); }}
                          className="text-xs">
                          <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${activeType === ct ? "opacity-100" : "opacity-0"}`} />
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
                <button className="ms-2 opacity-60 hover:opacity-100" onClick={() => setSelectedRows(new Set())}>✕</button>
              </span>
            )}
          </div>
        );
      })()}

      {/* Error banner */}
      {fetchError && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
          <p className="font-semibold mb-1">{isRTL ? "خطأ في تحميل البيانات:" : "Error loading data:"}</p>
          <p className="font-mono text-xs break-all">{fetchError}</p>
          <p className="mt-2 text-xs opacity-80">
            {isRTL
              ? "تأكد من تشغيل ملف SQL في Supabase (sql-step2-client-metrics-view.sql)"
              : "Make sure you ran the SQL fix in Supabase (sql-step2-client-metrics-view.sql)"}
          </p>
        </div>
      )}

      {/* Search + Table */}
      <Card>
        <CardContent className="p-0">
          {/* Search + count summary */}
          <div className="p-4 border-b border-border flex items-center gap-4 flex-wrap">
            <div className="relative max-w-sm flex-1">
              <Search className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground ${isRTL ? "right-3" : "left-3"}`} />
              <Input
                placeholder={t.search}
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className={isRTL ? "pr-9" : "pl-9"}
              />
            </div>

            {/* Total / filtered count — always visible */}
            {!loading && (
              <div className="flex items-center gap-2 shrink-0">
                {/* Total loaded from DB */}
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs font-semibold text-primary">
                  {isRTL ? "الإجمالي في قاعدة البيانات:" : "Total in DB:"}
                  <span className="text-base font-bold">{clients.length.toLocaleString()}</span>
                  {isRTL ? "عميل" : "clients"}
                </span>

                {/* Filtered count — only show when filters narrow it down */}
                {table.getFilteredRowModel().rows.length !== clients.length && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 border border-orange-200 text-xs font-semibold text-orange-700 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-300">
                    {isRTL ? "بعد التصفية:" : "After filter:"}
                    <span className="text-base font-bold">{table.getFilteredRowModel().rows.length.toLocaleString()}</span>
                  </span>
                )}
              </div>
            )}
          </div>


          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b border-border bg-muted/30">
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider"
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
                      {Array(7).fill(0).map((_, j) => (
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
                        transition={{ delay: i * 0.02 }}
                        className={`border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer ${expanded[row.original.id] ? "bg-muted/20" : ""}`}
                        onClick={() => toggleExpand(row.original.id)}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-4 py-3" onClick={cell.column.id === "select" ? (e) => e.stopPropagation() : undefined}>
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
      {selectedClient && dialogType === "status" && (
        <UpdateStatusDialog
          client={selectedClient}
          locale={locale}
          onClose={() => { setSelectedClient(null); setDialogType(null); }}
          onSuccess={(newStatus?: string) => {
            // Optimistically update the row immediately
            if (newStatus) {
              setClients((prev) => prev.map((c) =>
                c.id === selectedClient.id ? { ...c, current_status: newStatus as ClientStatus } : c
              ));
            }
            invalidateClientCache();
            setLogCache((p) => { const n = {...p}; delete n[selectedClient.id]; return n; });
            setExpanded((p) => ({ ...p, [selectedClient.id]: true }));
            fetchClients(true);
            setSelectedClient(null); setDialogType(null);
          }}
        />
      )}
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
