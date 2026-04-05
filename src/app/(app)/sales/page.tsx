"use client";

import { useEffect, useState, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { motion } from "framer-motion";
import {
  ChevronUp, ChevronDown, ChevronsUpDown,
  ChevronLeft, ChevronRight,
  Search, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  total_meters: number;
  cartela_count: number;
  level: OrderLevel;
  current_status: ClientStatus;
  month: number;
  year: number;
}

export default function SalesPage() {
  const { locale, filters, salespersonId, currentUser } = useStore();
  const isRTL = locale === "ar";

  const [clients, setClients]           = useState<SalesClientRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting]           = useState<SortingState>([]);
  const [selectedClient, setSelectedClient] = useState<SalesClientRow | null>(null);
  const [dialogType, setDialogType]     = useState<"status" | "note" | null>(null);

  const fetchClients = useCallback(async (forceRefresh = false) => {
    if (!currentUser) return;
    setLoading(true);

    const supabase   = createClient();
    const month      = filters.selectedMonth;
    const year       = filters.selectedYear;
    const spId       = salespersonId ?? filters.selectedSalesperson;

    // Fetch all rows for this salesperson (no 1000 row limit via pagination)
    let allRows: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      let q = supabase
        .from("client_monthly_metrics")
        .select("client_id,partner_id,client_name,top_product_name,total_meters,cartela_count,level,current_status,month,year")
        .range(from, from + PAGE - 1);
      if (year)  q = q.eq("year",  year);
      if (month) q = q.eq("month", month);
      if (spId)  q = q.eq("salesperson_id", spId);

      const { data, error } = await q;
      if (error || !data?.length) break;
      allRows = allRows.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    setClients(
      allRows.map((r) => ({
        id:               r.client_id,
        partner_id:       r.partner_id ?? "",
        name:             r.client_name ?? "",
        top_product_name: r.top_product_name ?? null,
        total_meters:     r.total_meters ?? 0,
        cartela_count:    r.cartela_count ?? 0,
        level:            (r.level ?? "RED") as OrderLevel,
        current_status:   (r.current_status ?? "NEW") as ClientStatus,
        month:            r.month ?? month ?? 0,
        year:             r.year  ?? year  ?? 0,
      }))
    );
    setLoading(false);
  }, [currentUser, filters.selectedMonth, filters.selectedYear, salespersonId]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const levelLabels: Record<OrderLevel, string> = {
    GREEN:    isRTL ? "طلبات ≥ 100م"              : "Orders ≥ 100m",
    ORANGE:   isRTL ? "طلبات < 100م"              : "Orders < 100m",
    RED:      isRTL ? "كارتيلا فقط — بدون أمتار" : "Cartela Only",
    INACTIVE: isRTL ? "لم يطلب هذا الشهر"         : "No Orders This Month",
  };

  const statusLabels: Record<ClientStatus, string> = {
    NEW:         isRTL ? "جديد"      : "New",
    FOLLOW_UP_1: isRTL ? "متابعة 1"  : "Follow Up 1",
    FOLLOW_UP_2: isRTL ? "متابعة 2"  : "Follow Up 2",
    RECOVERED:   isRTL ? "مستعاد"    : "Recovered",
    LOST:        isRTL ? "مفقود"     : "Lost",
    CANCELLED:   isRTL ? "ملغى"      : "Cancelled",
  };

  const columns: ColumnDef<SalesClientRow>[] = [
    {
      accessorKey: "month",
      header: isRTL ? "الشهر" : "Month",
      cell: ({ row }) => {
        const m = row.original.month;
        const y = row.original.year;
        if (!m) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-semibold">{isRTL ? MONTHS_AR[m - 1] : MONTHS_EN[m - 1]}</span>
            <span className="text-[10px] text-muted-foreground">{y}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "partner_id",
      header: isRTL ? "رقم العميل" : "Partner ID",
      cell: ({ getValue }) => (
        <span className="text-xs font-mono font-semibold text-muted-foreground">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: isRTL ? "اسم العميل" : "Client Name",
      cell: ({ getValue }) => (
        <span className="font-medium text-sm max-w-[180px] block">{getValue() as string}</span>
      ),
    },
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
    {
      accessorKey: "total_meters",
      header: isRTL ? "الأمتار" : "Meters",
      cell: ({ getValue }) => {
        const m = getValue() as number;
        if (!m) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <span className="text-sm font-bold tabular-nums">
            {formatNumber(m)} {isRTL ? "متر" : "meters"}
          </span>
        );
      },
    },
    {
      accessorKey: "cartela_count",
      header: isRTL ? "كارتيلا" : "Cartela",
      cell: ({ getValue }) => {
        const q = getValue() as number;
        if (!q) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-700">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {q}
          </span>
        );
      },
    },
    {
      accessorKey: "level",
      header: isRTL ? "المستوى" : "Level",
      cell: ({ getValue }) => {
        const level = getValue() as OrderLevel;
        return (
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${getLevelBadgeColor(level)}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {levelLabels[level]}
          </span>
        );
      },
    },
    {
      accessorKey: "current_status",
      header: isRTL ? "الحالة" : "Status",
      cell: ({ getValue }) => {
        const status = getValue() as ClientStatus;
        return (
          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(status)}`}>
            {statusLabels[status]}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: isRTL ? "الإجراءات" : "Actions",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSelectedClient(row.original); setDialogType("status"); }}
            className="h-7 px-2 text-xs"
          >
            {isRTL ? "تحديث" : "Status"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSelectedClient(row.original); setDialogType("note"); }}
            className="h-7 px-2 text-xs"
          >
            {isRTL ? "ملاحظة" : "Note"}
          </Button>
        </div>
      ),
    },
  ];

  const table = useReactTable({
    data: clients,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  });

  const SortIcon = ({ col }: { col: any }) => {
    const sorted = col.getIsSorted();
    if (sorted === "asc")  return <ChevronUp   className="h-3 w-3 ml-1 inline-block" />;
    if (sorted === "desc") return <ChevronDown  className="h-3 w-3 ml-1 inline-block" />;
    return <ChevronsUpDown className="h-3 w-3 ml-1 inline-block opacity-40" />;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {isRTL ? "عملائي" : "My Clients"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isRTL
              ? "قائمة العملاء المُسندين إليك — مُصفَّاة تلقائياً بحسابك"
              : "Clients assigned to you — automatically filtered to your account"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchClients(true)}
          disabled={loading}
          className="gap-2 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {isRTL ? "تحديث" : "Refresh"}
        </Button>
      </div>

      {/* Filters: only month + year; salesperson fixed to logged-in user */}
      <FilterBar locale={locale} showSalesperson={false} showLevel={false} showStatus={false} />

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder={isRTL ? "ابحث باسم العميل أو الرقم..." : "Search by client name or ID..."}
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="h-9 pl-8"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-border bg-muted/50">
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors"
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
                      <td key={j} className="px-4 py-3">
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
                table.getRowModel().rows.map((row, i) => (
                  <motion.tr
                    key={row.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.01, 0.2) }}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && table.getPageCount() > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30 text-xs text-muted-foreground">
            <span>
              {isRTL
                ? `عرض ${table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}–${Math.min((table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize, table.getFilteredRowModel().rows.length)} من ${table.getFilteredRowModel().rows.length}`
                : `Showing ${table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}–${Math.min((table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize, table.getFilteredRowModel().rows.length)} of ${table.getFilteredRowModel().rows.length}`}
            </span>
            <div className="flex items-center gap-2">
              <Select
                value={table.getState().pagination.pageSize.toString()}
                onValueChange={(v) => table.setPageSize(Number(v))}
              >
                <SelectTrigger className="h-7 w-20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[20, 50, 100].map((s) => (
                    <SelectItem key={s} value={s.toString()}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="flex items-center gap-1 px-2">
                  {table.getState().pagination.pageIndex + 1}/{table.getPageCount()}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      {selectedClient && dialogType === "status" && (
        <UpdateStatusDialog
          client={selectedClient}
          locale={locale}
          onClose={() => { setSelectedClient(null); setDialogType(null); }}
          onSuccess={() => { fetchClients(); setSelectedClient(null); setDialogType(null); }}
        />
      )}
      {selectedClient && dialogType === "note" && (
        <AddNoteDialog
          client={selectedClient}
          locale={locale}
          onClose={() => { setSelectedClient(null); setDialogType(null); }}
          onSuccess={() => { fetchClients(); setSelectedClient(null); setDialogType(null); }}
        />
      )}
    </div>
  );
}
