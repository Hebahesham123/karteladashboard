"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronUp, ChevronDown, ChevronsUpDown,
  ChevronLeft, ChevronRight, ChevronRight as ExpandIcon,
  Search, RefreshCw, Check, MessageSquare, History,
  ArrowRight, StickyNote,
} from "lucide-react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel,
  flexRender, type ColumnDef, type SortingState, type ColumnFiltersState,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { FilterBar } from "@/components/shared/FilterBar";
import { UpdateStatusDialog } from "@/components/clients/UpdateStatusDialog";
import { AddNoteDialog } from "@/components/clients/AddNoteDialog";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";
import { getLevelBadgeColor, getStatusColor, formatNumber } from "@/lib/utils";
import type { ClientStatus, OrderLevel } from "@/types/database";

const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];

interface SalesClientRow {
  id: string;
  partner_id: string;
  name: string;
  top_product_name: string | null;
  customer_type: string | null;
  total_meters: number;
  total_revenue: number;
  order_count: number;
  cartela_count: number;
  level: OrderLevel;
  current_status: ClientStatus;
  notes: string | null;
  month: number;
  year: number;
}

interface HistoryEntry {
  id: string;
  old_status: ClientStatus | null;
  new_status: ClientStatus;
  reason: string | null;
  created_at: string;
  user_name: string;
}

interface LogEntry {
  id: string;
  activity_type: "STATUS_CHANGE" | "NOTE_ADDED";
  description: string;
  metadata: Record<string, any> | null;
  created_at: string;
  user_name: string;
}

function timeAgo(iso: string, isRTL: boolean): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isRTL) {
    if (diff < 60)    return "الآن";
    if (diff < 3600)  return `منذ ${Math.floor(diff/60)} دقيقة`;
    if (diff < 86400) return `منذ ${Math.floor(diff/3600)} ساعة`;
    return new Date(iso).toLocaleDateString("ar-EG", { day:"numeric", month:"short" });
  }
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day:"numeric", month:"short" });
}

export default function SalesPage() {
  const { locale, filters, salespersonId, currentUser } = useStore();
  const isRTL = locale === "ar";

  const [clients, setClients]             = useState<SalesClientRow[]>([]);
  const [loading, setLoading]             = useState(true);
  const [globalFilter, setGlobalFilter]   = useState("");
  const [sorting, setSorting]             = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [selectedClient, setSelectedClient] = useState<SalesClientRow | null>(null);
  const [dialogType, setDialogType]       = useState<"status" | "note" | null>(null);
  const [prodOpen, setProdOpen]           = useState(false);
  const [typeOpen, setTypeOpen]           = useState(false);

  // Expand state: clientId → open/closed
  const [expanded, setExpanded]           = useState<Record<string, boolean>>({});
  // Log cache: clientId → log entries
  const [logCache, setLogCache]           = useState<Record<string, LogEntry[]>>({});
  const [logLoading, setLogLoading]       = useState<Record<string, boolean>>({});

  const fetchClients = useCallback(async () => {
    if (!currentUser) return;
    if (currentUser.role === "sales" && !salespersonId) { setLoading(false); return; }
    setLoading(true);

    const supabase = createClient();
    const month = filters.selectedMonth;
    const year  = filters.selectedYear;
    const spId  = currentUser.role === "sales" ? salespersonId : (salespersonId ?? filters.selectedSalesperson);

    const VIEW_COLS = "client_id,partner_id,client_name,top_product_name,customer_type,total_meters,total_revenue,order_count,cartela_count,level,current_status,month,year";

    let allRows: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      let q = supabase.from("client_monthly_metrics").select(VIEW_COLS)
                .neq("customer_type", "الشركات الشقيقة")
                .range(from, from + PAGE - 1);
      if (year)  q = q.eq("year", year);
      if (month) q = q.eq("month", month);
      if (spId)  q = q.eq("salesperson_id", spId);
      const { data, error } = await q;
      if (error || !data?.length) break;
      allRows = allRows.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // Batch-fetch notes + live current_status from clients table (not view — view may lag)
    const clientIds = Array.from(new Set(allRows.map((r) => r.client_id)));
    let clientMeta: Record<string, { notes: string | null; current_status: string | null }> = {};
    if (clientIds.length > 0) {
      const chunks: string[][] = [];
      for (let i = 0; i < clientIds.length; i += 500) chunks.push(clientIds.slice(i, i + 500));
      for (const chunk of chunks) {
        const { data: rows } = await supabase
          .from("clients")
          .select("id, notes, current_status")
          .in("id", chunk);
        (rows ?? []).forEach((n: any) => {
          clientMeta[n.id] = { notes: n.notes ?? null, current_status: n.current_status ?? null };
        });
      }
    }

    setClients(
      allRows.map((r) => ({
        id:               r.client_id,
        partner_id:       r.partner_id ?? "",
        name:             r.client_name ?? "",
        top_product_name: r.top_product_name ?? null,
        customer_type:    r.customer_type ?? null,
        total_meters:     Number(r.total_meters)  || 0,
        total_revenue:    Number(r.total_revenue) || 0,
        order_count:      Number(r.order_count)   || 0,
        cartela_count:    Number(r.cartela_count) || 0,
        level:            (r.level ?? "RED") as OrderLevel,
        current_status:   (clientMeta[r.client_id]?.current_status ?? r.current_status ?? "NEW") as ClientStatus,
        notes:            clientMeta[r.client_id]?.notes ?? null,
        month:            r.month ?? month ?? 0,
        year:             r.year  ?? year  ?? 0,
      })).sort((a, b) => b.total_meters - a.total_meters)
    );
    setLoading(false);
  }, [currentUser, filters.selectedMonth, filters.selectedYear, salespersonId]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const fetchLog = async (clientId: string) => {
    if (logCache[clientId]) return; // already loaded
    setLogLoading((p) => ({ ...p, [clientId]: true }));
    const supabase = createClient();

    const [{ data: hist }, { data: acts }] = await Promise.all([
      supabase
        .from("client_status_history")
        .select("id,old_status,new_status,reason,created_at,users(full_name)")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("activity_logs")
        .select("id,activity_type,description,metadata,created_at,users(full_name)")
        .eq("entity_id", clientId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    // Merge and sort by date
    const entries: LogEntry[] = [
      ...(hist ?? []).map((h: any) => ({
        id: `h_${h.id}`,
        activity_type: "STATUS_CHANGE" as const,
        description: h.reason ?? "",
        metadata: { old_status: h.old_status, new_status: h.new_status, reason: h.reason },
        created_at: h.created_at,
        user_name: h.users?.full_name ?? "—",
      })),
      ...(acts ?? []).filter((a: any) => a.activity_type === "NOTE_ADDED").map((a: any) => ({
        id: `a_${a.id}`,
        activity_type: "NOTE_ADDED" as const,
        description: a.description ?? "",
        metadata: a.metadata,
        created_at: a.created_at,
        user_name: a.users?.full_name ?? "—",
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setLogCache((p) => ({ ...p, [clientId]: entries }));
    setLogLoading((p) => ({ ...p, [clientId]: false }));
  };

  const toggleExpand = (clientId: string) => {
    const opening = !expanded[clientId];
    setExpanded((p) => ({ ...p, [clientId]: opening }));
    if (opening) fetchLog(clientId);
  };

  const STATUS_LABELS: Record<ClientStatus, string> = {
    NEW: isRTL ? "جديد" : "New",
    FOLLOW_UP_1: isRTL ? "متابعة 1" : "Follow Up 1",
    FOLLOW_UP_2: isRTL ? "متابعة 2" : "Follow Up 2",
    RECOVERED: isRTL ? "مستعاد" : "Recovered",
    LOST: isRTL ? "مفقود" : "Lost",
    CANCELLED: isRTL ? "ملغى" : "Cancelled",
  };

  const LEVEL_LABELS: Record<OrderLevel, string> = {
    GREEN:    isRTL ? "≥ 100م" : "≥ 100m",
    ORANGE:   isRTL ? "< 100م" : "< 100m",
    RED:      isRTL ? "كارتيلا" : "Cartela",
    INACTIVE: isRTL ? "خامل" : "Dormant",
  };

  const columns: ColumnDef<SalesClientRow>[] = [
    // Expand toggle
    {
      id: "expand",
      header: "",
      cell: ({ row }) => {
        const isOpen = expanded[row.original.id];
        const hasNote = !!row.original.notes;
        return (
          <button
            onClick={() => toggleExpand(row.original.id)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <motion.span animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.15 }}>
              <ExpandIcon className="h-3.5 w-3.5" />
            </motion.span>
            {hasNote && <StickyNote className="h-3 w-3 text-amber-500" />}
          </button>
        );
      },
    },
    // Month
    {
      accessorKey: "month",
      header: isRTL ? "الشهر" : "Month",
      cell: ({ row }) => {
        const m = row.original.month;
        const y = row.original.year;
        if (!m) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-semibold">{isRTL ? MONTHS_AR[m-1] : MONTHS_EN[m-1]}</span>
            <span className="text-[10px] text-muted-foreground">{y}</span>
          </div>
        );
      },
    },
    // Partner ID
    {
      accessorKey: "partner_id",
      header: isRTL ? "رقم العميل" : "Partner ID",
      cell: ({ getValue }) => (
        <span className="text-xs font-mono text-muted-foreground">{getValue() as string}</span>
      ),
    },
    // Client Name
    {
      accessorKey: "name",
      header: isRTL ? "اسم العميل" : "Client Name",
      cell: ({ getValue }) => (
        <span className="font-medium text-sm max-w-[180px] block truncate">{getValue() as string}</span>
      ),
    },
    // Customer Type
    {
      accessorKey: "customer_type",
      header: isRTL ? "النوع" : "Type",
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
    // Product
    {
      accessorKey: "top_product_name",
      header: isRTL ? "المنتج" : "Product",
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        if (!v) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 text-xs font-semibold">
            {v}
          </span>
        );
      },
    },
    // Meters
    {
      accessorKey: "total_meters",
      header: isRTL ? "الأمتار" : "Meters",
      cell: ({ getValue }) => {
        const m = getValue() as number;
        if (!m) return <span className="text-muted-foreground text-xs">—</span>;
        return <span className="text-sm font-bold tabular-nums">{formatNumber(m)}m</span>;
      },
    },
    // Revenue
    {
      accessorKey: "total_revenue",
      header: isRTL ? "الإجمالي" : "Revenue",
      cell: ({ getValue }) => {
        const rev = getValue() as number;
        if (!rev) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <span className="text-sm font-semibold tabular-nums text-green-700 dark:text-green-400">
            {rev.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        );
      },
    },
    // Level
    {
      accessorKey: "level",
      header: isRTL ? "المستوى" : "Level",
      cell: ({ getValue }) => {
        const level = getValue() as OrderLevel;
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${getLevelBadgeColor(level)}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
            {LEVEL_LABELS[level]}
          </span>
        );
      },
    },
    // Status
    {
      accessorKey: "current_status",
      header: isRTL ? "الحالة" : "Status",
      cell: ({ getValue }) => {
        const status = getValue() as ClientStatus;
        return (
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(status)}`}>
            {STATUS_LABELS[status]}
          </span>
        );
      },
    },
    // Note preview
    {
      accessorKey: "notes",
      header: isRTL ? "ملاحظة" : "Note",
      cell: ({ getValue }) => {
        const note = getValue() as string | null;
        if (!note) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 max-w-[160px] truncate" title={note}>
            <MessageSquare className="h-3 w-3 shrink-0" />
            {note}
          </span>
        );
      },
    },
    // Actions
    {
      id: "actions",
      header: isRTL ? "إجراءات" : "Actions",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => { setSelectedClient(row.original); setDialogType("status"); }} className="h-7 px-2 text-xs">
            {isRTL ? "حالة" : "Status"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setSelectedClient(row.original); setDialogType("note"); }} className="h-7 px-2 text-xs">
            {isRTL ? "ملاحظة" : "Note"}
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

  const SortIcon = ({ col }: { col: any }) => {
    const s = col.getIsSorted();
    if (s === "asc")  return <ChevronUp   className="h-3 w-3 ml-1 inline-block" />;
    if (s === "desc") return <ChevronDown  className="h-3 w-3 ml-1 inline-block" />;
    return <ChevronsUpDown className="h-3 w-3 ml-1 inline-block opacity-40" />;
  };

  const productOptions = Array.from(new Set(clients.map(c => c.top_product_name).filter(Boolean))).sort() as string[];
  const typeOptions    = Array.from(new Set(clients.map(c => c.customer_type).filter(Boolean))).sort() as string[];
  const activeProd     = (table.getColumn("top_product_name")?.getFilterValue() as string) ?? "";
  const activeType     = (table.getColumn("customer_type")?.getFilterValue() as string) ?? "";

  const totalMeters  = clients.reduce((s, c) => s + c.total_meters, 0);
  const totalRevenue = clients.reduce((s, c) => s + c.total_revenue, 0);
  const activeCount  = clients.filter(c => c.total_meters > 0).length;

  const [fixingLink, setFixingLink] = useState(false);
  const [fixError, setFixError]     = useState("");

  const handleFixLink = async () => {
    setFixingLink(true);
    setFixError("");
    try {
      const res = await fetch("/api/fix-my-link", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setFixError(data.error ?? (isRTL ? "حدث خطأ" : "An error occurred"));
      } else {
        // Reload the page so the layout re-checks the salespersonId
        window.location.reload();
      }
    } catch {
      setFixError(isRTL ? "حدث خطأ في الاتصال" : "Connection error");
    }
    setFixingLink(false);
  };

  if (!loading && currentUser?.role === "sales" && !salespersonId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
        <div className="h-16 w-16 rounded-2xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center">
          <Search className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{isRTL ? "الحساب غير مرتبط" : "Account not linked"}</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            {isRTL
              ? "حسابك غير مرتبط بملف مندوب بعد. اضغط الزر لإصلاحه تلقائياً."
              : "Your account is not linked to a salesperson profile yet. Press the button to fix it automatically."}
          </p>
        </div>
        <Button onClick={handleFixLink} disabled={fixingLink} className="gap-2 min-w-[180px]">
          {fixingLink
            ? <><RefreshCw className="h-4 w-4 animate-spin" />{isRTL ? "جارٍ الربط..." : "Linking..."}</>
            : <><RefreshCw className="h-4 w-4" />{isRTL ? "ربط حسابي تلقائياً" : "Auto-link my account"}</>}
        </Button>
        {fixError && (
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2 max-w-sm">
            {fixError}
            <br />
            <span className="text-xs opacity-70">{isRTL ? "تواصل مع المسؤول." : "Please contact the admin."}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{isRTL ? "عملائي" : "My Clients"}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isRTL ? "اضغط ← على أي صف لعرض سجل الحالات والملاحظات" : "Click ← on any row to view its status log & notes"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchClients()} disabled={loading} className="gap-2 shrink-0">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {isRTL ? "تحديث" : "Refresh"}
        </Button>
      </div>

      {/* Quick stats */}
      {!loading && clients.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">{isRTL ? "عملاء نشطون" : "Active Clients"}</p>
            <p className="text-xl font-bold">{activeCount.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">{isRTL ? "إجمالي الأمتار" : "Total Meters"}</p>
            <p className="text-xl font-bold">{formatNumber(Math.round(totalMeters))}m</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">{isRTL ? "الإيراد" : "Revenue (EGP)"}</p>
            <p className="text-xl font-bold text-green-700 dark:text-green-400">{formatNumber(Math.round(totalRevenue))}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <FilterBar locale={locale} showSalesperson={false} showLevel={false} showStatus={false} />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground ${isRTL ? "right-2.5" : "left-2.5"}`} />
          <Input
            placeholder={isRTL ? "ابحث باسم العميل أو الرقم..." : "Search by name or ID..."}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className={`h-8 text-xs ${isRTL ? "pr-8" : "pl-8"}`}
          />
        </div>
        <Popover open={prodOpen} onOpenChange={setProdOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" className="w-44 h-8 text-xs justify-between font-normal">
              <span className="truncate">{activeProd || (isRTL ? "كل المنتجات" : "All Products")}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder={isRTL ? "ابحث عن منتج..." : "Search product..."} className="text-xs h-8" />
              <CommandList>
                <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">{isRTL ? "لا توجد نتائج" : "No results"}</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="__all__" onSelect={() => { table.getColumn("top_product_name")?.setFilterValue(undefined); setProdOpen(false); }} className="text-xs">
                    <Check className={`h-3.5 w-3.5 mr-2 ${!activeProd ? "opacity-100" : "opacity-0"}`} />
                    {isRTL ? "كل المنتجات" : "All Products"}
                  </CommandItem>
                  {productOptions.map((p) => (
                    <CommandItem key={p} value={p} onSelect={() => { table.getColumn("top_product_name")?.setFilterValue(activeProd === p ? undefined : p); setProdOpen(false); }} className="text-xs">
                      <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${activeProd === p ? "opacity-100" : "opacity-0"}`} />
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
            <Button variant="outline" role="combobox" className="w-36 h-8 text-xs justify-between font-normal">
              <span className="truncate">{activeType || (isRTL ? "كل الأنواع" : "All Types")}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-0" align="start">
            <Command>
              <CommandInput placeholder={isRTL ? "ابحث..." : "Search..."} className="text-xs h-8" />
              <CommandList>
                <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">{isRTL ? "لا توجد نتائج" : "No results"}</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="__all__" onSelect={() => { table.getColumn("customer_type")?.setFilterValue(undefined); setTypeOpen(false); }} className="text-xs">
                    <Check className={`h-3.5 w-3.5 mr-2 ${!activeType ? "opacity-100" : "opacity-0"}`} />
                    {isRTL ? "كل الأنواع" : "All Types"}
                  </CommandItem>
                  {typeOptions.map((ct) => (
                    <CommandItem key={ct} value={ct} onSelect={() => { table.getColumn("customer_type")?.setFilterValue(activeType === ct ? undefined : ct); setTypeOpen(false); }} className="text-xs">
                      <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${activeType === ct ? "opacity-100" : "opacity-0"}`} />
                      {ct}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id} className="border-b border-border bg-muted/50">
                    {hg.headers.map((header) => (
                      <th
                        key={header.id}
                        className="px-3 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && <SortIcon col={header.column} />}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {loading ? (
                  Array(8).fill(0).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {columns.map((_, j) => (
                        <td key={j} className="px-3 py-3">
                          <div className="h-4 bg-muted animate-pulse rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : table.getRowModel().rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="text-center py-16 text-muted-foreground text-sm">
                      {isRTL ? "لا توجد بيانات" : "No clients found"}
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row, i) => {
                    const isOpen = expanded[row.original.id];
                    const logs   = logCache[row.original.id] ?? [];
                    const isLoadingLog = logLoading[row.original.id];

                    return (
                      <>
                        <motion.tr
                          key={row.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: Math.min(i * 0.006, 0.12) }}
                          className={`border-b border-border/50 transition-colors ${isOpen ? "bg-primary/5" : i % 2 === 1 ? "bg-muted/10 hover:bg-muted/30" : "hover:bg-muted/30"}`}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <td key={cell.id} className="px-3 py-2.5 whitespace-nowrap">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </motion.tr>

                        {/* Expandable log panel */}
                        <AnimatePresence>
                          {isOpen && (
                            <motion.tr
                              key={`${row.id}_log`}
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                            >
                              <td colSpan={columns.length} className="bg-muted/20 border-b border-border px-4 py-4">
                                <div className="space-y-3">
                                  {/* Current note */}
                                  {row.original.notes && (
                                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
                                      <StickyNote className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                                      <div>
                                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-0.5">
                                          {isRTL ? "الملاحظة الحالية" : "Current Note"}
                                        </p>
                                        <p className="text-sm text-foreground leading-relaxed">{row.original.notes}</p>
                                      </div>
                                    </div>
                                  )}

                                  {/* Log header */}
                                  <div className="flex items-center gap-2">
                                    <History className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                      {isRTL ? "سجل التغييرات" : "Activity Log"}
                                    </span>
                                  </div>

                                  {isLoadingLog ? (
                                    <div className="space-y-2">
                                      {Array(3).fill(0).map((_, k) => (
                                        <div key={k} className="h-10 bg-muted rounded-lg animate-pulse" />
                                      ))}
                                    </div>
                                  ) : logs.length === 0 ? (
                                    <p className="text-xs text-muted-foreground py-2">
                                      {isRTL ? "لا توجد سجلات بعد" : "No activity logged yet"}
                                    </p>
                                  ) : (
                                    <div className="space-y-2">
                                      {logs.map((log) => (
                                        <div key={log.id} className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                                          {log.activity_type === "STATUS_CHANGE" ? (
                                            <History className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                                          ) : (
                                            <MessageSquare className="h-3.5 w-3.5 text-purple-500 mt-0.5 shrink-0" />
                                          )}
                                          <div className="flex-1 min-w-0">
                                            {log.activity_type === "STATUS_CHANGE" && log.metadata && (
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${getStatusColor(log.metadata.old_status)}`}>
                                                  {STATUS_LABELS[log.metadata.old_status as ClientStatus] ?? log.metadata.old_status}
                                                </span>
                                                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                                <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${getStatusColor(log.metadata.new_status)}`}>
                                                  {STATUS_LABELS[log.metadata.new_status as ClientStatus] ?? log.metadata.new_status}
                                                </span>
                                                {log.metadata.reason && (
                                                  <span className="text-[10px] text-muted-foreground italic">— {log.metadata.reason}</span>
                                                )}
                                              </div>
                                            )}
                                            {log.activity_type === "NOTE_ADDED" && log.metadata?.note && (
                                              <p className="text-xs text-foreground">{log.metadata.note}</p>
                                            )}
                                            <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                                              <span className="font-medium">{log.user_name}</span>
                                              <span>·</span>
                                              <span>{timeAgo(log.created_at, isRTL)}</span>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Quick action buttons inside panel */}
                                  <div className="flex items-center gap-2 pt-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs gap-1.5"
                                      onClick={() => { setSelectedClient(row.original); setDialogType("status"); }}
                                    >
                                      <History className="h-3 w-3" />
                                      {isRTL ? "تغيير الحالة" : "Change Status"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs gap-1.5"
                                      onClick={() => { setSelectedClient(row.original); setDialogType("note"); }}
                                    >
                                      <MessageSquare className="h-3 w-3" />
                                      {isRTL ? "إضافة ملاحظة" : "Add Note"}
                                    </Button>
                                  </div>
                                </div>
                              </td>
                            </motion.tr>
                          )}
                        </AnimatePresence>
                      </>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loading && table.getPageCount() > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20 text-xs text-muted-foreground">
              <span>
                {isRTL
                  ? `${table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}–${Math.min((table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize, table.getFilteredRowModel().rows.length)} من ${table.getFilteredRowModel().rows.length}`
                  : `${table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}–${Math.min((table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize, table.getFilteredRowModel().rows.length)} of ${table.getFilteredRowModel().rows.length}`}
              </span>
              <div className="flex items-center gap-2">
                <Select value={table.getState().pagination.pageSize.toString()} onValueChange={(v) => table.setPageSize(Number(v))}>
                  <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[20, 50, 100].map((s) => <SelectItem key={s} value={s.toString()}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="flex items-center px-2">{table.getState().pagination.pageIndex + 1}/{table.getPageCount()}</span>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      {selectedClient && dialogType === "status" && (
        <UpdateStatusDialog
          client={selectedClient} locale={locale}
          onClose={() => { setSelectedClient(null); setDialogType(null); }}
          onSuccess={(newStatus?: string) => {
            // Optimistically update status in the table row immediately
            if (newStatus) {
              setClients((prev) => prev.map((c) =>
                c.id === selectedClient.id ? { ...c, current_status: newStatus as ClientStatus } : c
              ));
            }
            // Invalidate log cache so expanded panel refreshes
            setLogCache((p) => { const n = {...p}; delete n[selectedClient.id]; return n; });
            // Re-open the log panel for this client so changes are visible
            setExpanded((p) => ({ ...p, [selectedClient.id]: true }));
            fetchClients();
            setSelectedClient(null);
            setDialogType(null);
          }}
        />
      )}
      {selectedClient && dialogType === "note" && (
        <AddNoteDialog
          client={selectedClient} locale={locale}
          onClose={() => { setSelectedClient(null); setDialogType(null); }}
          onSuccess={() => {
            setLogCache((p) => { const n = {...p}; delete n[selectedClient.id]; return n; });
            setExpanded((p) => ({ ...p, [selectedClient.id]: true }));
            fetchClients();
            setSelectedClient(null);
            setDialogType(null);
          }}
        />
      )}
    </div>
  );
}
