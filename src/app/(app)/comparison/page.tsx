"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PageBack } from "@/components/layout/PageBack";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";
import { formatNumber } from "@/lib/utils";
import { dataCache } from "@/lib/dataCache";
import { ALLOWED_CUSTOMER_TYPES } from "@/lib/customerTypes";
import { isKartelaProductName, kartelaFamilyBaseKey } from "@/lib/kartelaProduct";

type CompareMode = "product" | "salesperson" | "client" | "kartela" | "net-profit";
type Period = { month: number; year: number };
/** left/mid/right = period1/2/3 values; in 2-month mode mid is unused (0). */
type CompareRow = {
  key: string;
  left: number;
  mid: number;
  right: number;
  /** Period 2 vs period 1 (two-month: vs period 2). */
  diff12: number;
  growth12: number;
  /** Period 3 vs period 2 (three-month mode only). */
  diff23: number;
  growth23: number;
};
type MonthCountMode = "two" | "three";
type TypeKind = "all" | "category" | "pricelist" | "customer_type";

type OrderJoinRow = {
  quantity: number | null;
  invoice_total: number | null;
  category: string | null;
  pricelist: string | null;
  products: { name: string | null } | null;
  clients: { name: string | null; customer_type: string | null } | null;
  salespersons: { name: string | null } | null;
};

function aggregateOrderRows(rows: OrderJoinRow[], mode: CompareMode, isRTL: boolean): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const pName = row.products?.name;
    const isK = isKartelaProductName(String(pName ?? ""));
    const qty = Number(row.quantity) || 0;
    const rev = Number(row.invoice_total) || 0;
    const cName = row.clients?.name;
    const spName = row.salespersons?.name;

    if (mode === "product") {
      if (isK) continue;
      const key = String(pName ?? "").trim();
      if (!key) continue;
      out.set(key, (out.get(key) ?? 0) + qty);
    } else if (mode === "salesperson") {
      if (isK) continue;
      const key = String(spName ?? "").trim();
      if (!key) continue;
      out.set(key, (out.get(key) ?? 0) + qty);
    } else if (mode === "client") {
      if (isK) continue;
      const key = String(cName ?? "").trim();
      if (!key) continue;
      out.set(key, (out.get(key) ?? 0) + qty);
    } else if (mode === "kartela") {
      if (!isK) continue;
      const key = String(cName ?? "").trim();
      if (!key) continue;
      out.set(key, (out.get(key) ?? 0) + qty);
    } else {
      if (isK) continue;
      const key = isRTL ? "صافي الربح" : "Net Profit";
      out.set(key, (out.get(key) ?? 0) + rev);
    }
  }
  return out;
}

const ORDERS_SELECT_BASE =
  "quantity, invoice_total, category, pricelist, products(name), clients(name, customer_type), salespersons(name)";
/** Inner join avoids giant `.in(client_id, …)` which triggers PostgREST 400 Bad Request (URL too long). */
const ORDERS_SELECT_CUSTOMER_TYPE =
  "quantity, invoice_total, category, pricelist, products(name), clients!inner(name, customer_type), salespersons(name)";

async function fetchOrdersForComparisonPeriod(
  supabase: ReturnType<typeof createClient>,
  period: Period,
  typeKind: TypeKind,
  typeValue: string,
  spFilter: string | null
): Promise<OrderJoinRow[]> {
  const tv = typeValue.trim();
  const pageSize = 1000;
  const all: OrderJoinRow[] = [];
  const useCustomerType = typeKind === "customer_type" && tv !== "";

  let from = 0;
  while (true) {
    let q = supabase
      .from("orders")
      .select(useCustomerType ? ORDERS_SELECT_CUSTOMER_TYPE : ORDERS_SELECT_BASE)
      .eq("month", period.month)
      .eq("year", period.year)
      .range(from, from + pageSize - 1);
    if (spFilter) q = q.eq("salesperson_id", spFilter);
    if (typeKind === "category" && tv) q = q.eq("category", tv);
    if (typeKind === "pricelist" && tv) q = q.eq("pricelist", tv);
    if (useCustomerType) q = q.eq("clients.customer_type", tv);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const raw = (data ?? []) as any[];
    for (const r of raw) {
      const p = Array.isArray(r.products) ? r.products[0] : r.products;
      const c = Array.isArray(r.clients) ? r.clients[0] : r.clients;
      const sp = Array.isArray(r.salespersons) ? r.salespersons[0] : r.salespersons;
      all.push({
        quantity: r.quantity,
        invoice_total: r.invoice_total,
        category: r.category,
        pricelist: r.pricelist,
        products: p ? { name: p.name ?? null } : null,
        clients: c ? { name: c.name ?? null, customer_type: c.customer_type ?? null } : null,
        salespersons: sp ? { name: sp.name ?? null } : null,
      });
    }
    if (raw.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

type DetailOrderRow = {
  invoice_ref: string;
  meters: number;
  client_name: string;
  product_name: string;
  salesperson: string;
  branch: string;
  dayDate: string;
  kartelaQty: number;
};

type DetailOrderContext = {
  branchByClientInvoice: Map<string, string>;
  branchByClient: Map<string, string>;
  kartelaByClientBase: Map<string, number>;
};

function normalizeInvoiceKey(ref: string): string {
  return ref.trim().toLowerCase().replace(/\s+/g, " ");
}

/** When explicit كارتله rows are missing, some uploads only store cartela in meter_breakdown labels. */
function kartelaQtyFromMeterBreakdown(raw: unknown): number {
  if (!raw || !Array.isArray(raw)) return 0;
  let sum = 0;
  for (const x of raw) {
    const label = String((x as { label?: string; name?: string })?.label ?? (x as { name?: string }).name ?? "").trim();
    const v = Number((x as { meters?: number }).meters) || 0;
    if (v <= 0 || !label) continue;
    if (
      /كارت|kartela|cartela/i.test(label) ||
      (/color\s*:/i.test(label) && /كارت/i.test(label)) ||
      /كرتون|carton/i.test(label)
    ) {
      sum += v;
    }
  }
  return sum;
}

function formatDayDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return cellDisplay(iso);
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function buildDetailOrderContext(rawRows: any[]): DetailOrderContext {
  const branchByClientInvoice = new Map<string, string>();
  const branchByClient = new Map<string, string>();
  const kartelaByClientBase = new Map<string, number>();

  for (const r of rawRows) {
    const cid = String(r.client_id ?? "").trim();
    const inv = normalizeInvoiceKey(String(r.invoice_ref ?? ""));
    const b = String(r.branch ?? "").trim();
    if (cid && b) {
      branchByClient.set(cid, b);
      if (inv) branchByClientInvoice.set(`${cid}|${inv}`, b);
    }

    const p = Array.isArray(r.products) ? r.products[0] : r.products;
    const pname = String(p?.name ?? "").trim();
    if (!cid || !isKartelaProductName(pname)) continue;
    const qty = Math.round(Number(r.quantity)) || 0;
    const base = kartelaFamilyBaseKey(pname);
    const k = `${cid}|${base}`;
    kartelaByClientBase.set(k, (kartelaByClientBase.get(k) ?? 0) + qty);
  }

  return { branchByClientInvoice, branchByClient, kartelaByClientBase };
}

/** Short label for client column: after a `/` use the rest (e.g. trade name), else first word. */
function primaryClientLabel(full: string): string {
  const s = full.trim();
  if (!s || s === "—") return "—";
  const parts = s.split("/");
  const core = parts.length > 1 ? parts.slice(1).join("/").trim() : s;
  const first = core.split(/\s+/).filter(Boolean)[0] ?? core;
  return first || "—";
}

function cellDisplay(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  return s || "—";
}

const DETAIL_SELECT =
  "invoice_ref, quantity, client_id, branch, invoice_date, created_at, meter_breakdown, products(name), clients(name), salespersons(name, code)";
const DETAIL_PAGE = 800;
const DETAIL_MAX_NET_PROFIT = 2500;
const DETAIL_MAX_OTHER = 8000;

let kartelaProductIdCache: { ids: string[]; at: number } | null = null;
const KARTELA_PID_CACHE_MS = 120_000;

async function getKartelaProductIds(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  if (kartelaProductIdCache && Date.now() - kartelaProductIdCache.at < KARTELA_PID_CACHE_MS) {
    return kartelaProductIdCache.ids;
  }
  const { data, error } = await supabase.from("products").select("id, name");
  if (error) throw new Error(error.message);
  const ids = (data ?? [])
    .filter((r: { name: string | null }) => isKartelaProductName(String(r.name ?? "")))
    .map((r: { id: string }) => r.id);
  kartelaProductIdCache = { ids, at: Date.now() };
  return ids;
}

function mapOrderRawToDetail(r: any, ctx: DetailOrderContext): DetailOrderRow {
  const p = Array.isArray(r.products) ? r.products[0] : r.products;
  const c = Array.isArray(r.clients) ? r.clients[0] : r.clients;
  const sp = Array.isArray(r.salespersons) ? r.salespersons[0] : r.salespersons;
  const productName = p?.name ?? null;
  const clientName = c?.name ?? null;
  const namePart = cellDisplay(sp?.name);
  const codePart = cellDisplay(sp?.code);
  const spLine =
    namePart === "—" && codePart === "—" ? "—" : codePart === "—" ? namePart : `${namePart} (${codePart})`;

  const cid = String(r.client_id ?? "").trim();
  const inv = normalizeInvoiceKey(String(r.invoice_ref ?? ""));
  const branchRaw = String(r.branch ?? "").trim();
  const branch =
    (cid && inv ? ctx.branchByClientInvoice.get(`${cid}|${inv}`) : undefined) ??
    (cid ? ctx.branchByClient.get(cid) : undefined) ??
    (branchRaw ? branchRaw : "—");

  const dayIso = r.invoice_date ?? r.created_at ?? null;
  const dayDate = formatDayDate(typeof dayIso === "string" ? dayIso : dayIso != null ? String(dayIso) : null);

  const pnameStr = String(productName ?? "").trim();
  const qty = Math.round(Number(r.quantity)) || 0;
  let kartelaQty = 0;
  if (isKartelaProductName(pnameStr)) {
    kartelaQty = qty;
  } else {
    const base = kartelaFamilyBaseKey(pnameStr);
    const fromMap = cid ? ctx.kartelaByClientBase.get(`${cid}|${base}`) ?? 0 : 0;
    kartelaQty = fromMap > 0 ? fromMap : kartelaQtyFromMeterBreakdown(r.meter_breakdown);
  }

  return {
    invoice_ref: cellDisplay(r.invoice_ref),
    meters: qty,
    client_name: cellDisplay(clientName),
    product_name: cellDisplay(productName),
    salesperson: spLine,
    branch: branch === "—" ? "—" : branch,
    dayDate,
    kartelaQty,
  };
}

async function paginateOrderDetailQuery(
  runRange: (from: number, to: number) => any,
  maxRows: number
): Promise<DetailOrderRow[]> {
  const rawAll: any[] = [];
  let from = 0;
  while (rawAll.length < maxRows) {
    const to = from + DETAIL_PAGE - 1;
    const { data, error } = await runRange(from, to);
    if (error) throw new Error(error.message);
    const raw = (data ?? []) as any[];
    for (const r of raw) {
      rawAll.push(r);
      if (rawAll.length >= maxRows) break;
    }
    if (raw.length < DETAIL_PAGE) break;
    from += DETAIL_PAGE;
  }
  const ctx = buildDetailOrderContext(rawAll);
  return rawAll.map((r) => mapOrderRawToDetail(r, ctx));
}

async function fetchOrderLinesForLine(
  supabase: ReturnType<typeof createClient>,
  period: Period,
  mode: CompareMode,
  lineKey: string,
  typeKind: TypeKind,
  typeValue: string,
  spFilter: string | null,
  isRTL: boolean
): Promise<DetailOrderRow[]> {
  const tv = typeValue.trim();
  const useTypeFilters = typeKind !== "all" && tv !== "";
  const useCustomerType = useTypeFilters && typeKind === "customer_type";

  const detailSelectForQuery = useCustomerType
    ? "invoice_ref, quantity, client_id, branch, invoice_date, created_at, meter_breakdown, products(name), clients!inner(name, customer_type), salespersons(name, code)"
    : DETAIL_SELECT;

  const baseOrders = () => {
    let q = supabase
      .from("orders")
      .select(detailSelectForQuery)
      .eq("month", period.month)
      .eq("year", period.year);
    if (spFilter) q = q.eq("salesperson_id", spFilter);
    if (useTypeFilters && typeKind === "category") q = q.eq("category", tv);
    if (useTypeFilters && typeKind === "pricelist") q = q.eq("pricelist", tv);
    if (useCustomerType) q = q.eq("clients.customer_type", tv);
    return q;
  };

  const netKeys = new Set([isRTL ? "صافي الربح" : "Net Profit", "Net Profit", "صافي الربح"]);

  if (mode === "product") {
    const { data: prodRows, error } = await supabase.from("products").select("id").eq("name", lineKey);
    if (error) throw new Error(error.message);
    const productIds = (prodRows ?? []).map((r: { id: string }) => r.id);
    if (!productIds.length) return [];
    return paginateOrderDetailQuery(
      (from, to) => baseOrders().in("product_id", productIds).range(from, to),
      DETAIL_MAX_OTHER
    );
  }

  if (mode === "salesperson") {
    const { data: spRows, error } = await supabase.from("salespersons").select("id").eq("name", lineKey);
    if (error) throw new Error(error.message);
    const spIds = (spRows ?? []).map((r: { id: string }) => r.id);
    if (!spIds.length) return [];
    return paginateOrderDetailQuery(
      (from, to) => baseOrders().in("salesperson_id", spIds).range(from, to),
      DETAIL_MAX_OTHER
    );
  }

  if (mode === "client") {
    const { data: clRows, error } = await supabase.from("clients").select("id").eq("name", lineKey);
    if (error) throw new Error(error.message);
    const cids = (clRows ?? []).map((r: { id: string }) => r.id);
    if (!cids.length) return [];
    const kIds = await getKartelaProductIds(supabase);
    if (!kIds.length) {
      return paginateOrderDetailQuery((from, to) => baseOrders().in("client_id", cids).range(from, to), DETAIL_MAX_OTHER);
    }
    const list = `(${kIds.join(",")})`;
    return paginateOrderDetailQuery(
      (from, to) => baseOrders().in("client_id", cids).not("product_id", "in", list).range(from, to),
      DETAIL_MAX_OTHER
    );
  }

  if (mode === "kartela") {
    const { data: clRows, error } = await supabase.from("clients").select("id").eq("name", lineKey);
    if (error) throw new Error(error.message);
    const cids = (clRows ?? []).map((r: { id: string }) => r.id);
    if (!cids.length) return [];
    const kIds = await getKartelaProductIds(supabase);
    if (!kIds.length) return [];
    return paginateOrderDetailQuery(
      (from, to) => baseOrders().in("client_id", cids).in("product_id", kIds).range(from, to),
      DETAIL_MAX_OTHER
    );
  }

  if (mode === "net-profit" && netKeys.has(lineKey)) {
    const kIds = await getKartelaProductIds(supabase);
    if (!kIds.length) {
      return paginateOrderDetailQuery((from, to) => baseOrders().range(from, to), DETAIL_MAX_NET_PROFIT);
    }
    const list = `(${kIds.join(",")})`;
    return paginateOrderDetailQuery(
      (from, to) => baseOrders().not("product_id", "in", list).range(from, to),
      DETAIL_MAX_NET_PROFIT
    );
  }

  return [];
}

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const modeOptions: CompareMode[] = ["product", "salesperson", "client", "kartela", "net-profit"];

function growthPct(right: number, left: number): number {
  if (left === 0) return right > 0 ? 100 : 0;
  return ((right - left) / left) * 100;
}

type DetailTableLabels = {
  detailOrders: string;
  detailNone: string;
  colInvoice: string;
  colKartela: string;
  colBranch: string;
  colDayDate: string;
  colMeters: string;
  colClient: string;
  colProduct: string;
  colSp: string;
  expandName: string;
  collapseName: string;
};

function ComparisonOrderDetailTable({
  list,
  periodLabel,
  labels,
  isRTL,
}: {
  list: DetailOrderRow[];
  periodLabel: string;
  labels: DetailTableLabels;
  isRTL: boolean;
}) {
  const [nameOpen, setNameOpen] = useState<Record<string, boolean>>({});

  const sortedList = useMemo(() => {
    const hasInvoice = (d: DetailOrderRow) => {
      const v = (d.invoice_ref ?? "").trim();
      return v.length > 0 && v !== "—";
    };
    return [...list].sort((a, b) => {
      const aOk = hasInvoice(a);
      const bOk = hasInvoice(b);
      if (aOk !== bOk) return aOk ? -1 : 1;
      if (b.meters !== a.meters) return b.meters - a.meters;
      return a.invoice_ref.localeCompare(b.invoice_ref, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [list]);

  return (
    <div
      className="rounded-xl border border-border/80 bg-card shadow-sm overflow-hidden ring-1 ring-black/[0.04] dark:ring-white/[0.06]"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/80 bg-gradient-to-b from-muted/50 to-muted/30 px-3 py-2">
        <p className="text-xs font-semibold text-foreground">
          {periodLabel} · {labels.detailOrders}{" "}
          <span className="tabular-nums text-muted-foreground font-normal">({list.length})</span>
        </p>
      </div>
      <div className="max-h-[min(70vh,720px)] overflow-auto overscroll-contain">
        <table className="w-full min-w-0 text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 px-3 py-2.5 text-start font-semibold border-b border-border/80 shadow-[0_1px_0_0_hsl(var(--border))]">
                {labels.colInvoice}
              </th>
              <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 px-3 py-2.5 text-end font-semibold border-b border-border/80 whitespace-nowrap shadow-[0_1px_0_0_hsl(var(--border))]">
                {labels.colKartela}
              </th>
              <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 px-3 py-2.5 text-start font-semibold border-b border-border/80 shadow-[0_1px_0_0_hsl(var(--border))]">
                {labels.colBranch}
              </th>
              <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 px-3 py-2.5 text-start font-semibold border-b border-border/80 whitespace-nowrap shadow-[0_1px_0_0_hsl(var(--border))]">
                {labels.colDayDate}
              </th>
              <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 px-3 py-2.5 text-end font-semibold border-b border-border/80 whitespace-nowrap shadow-[0_1px_0_0_hsl(var(--border))]">
                {labels.colMeters}
              </th>
              <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 px-3 py-2.5 text-start font-semibold border-b border-border/80 min-w-[8rem] shadow-[0_1px_0_0_hsl(var(--border))]">
                {labels.colClient}
              </th>
              <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 px-3 py-2.5 text-start font-semibold border-b border-border/80 shadow-[0_1px_0_0_hsl(var(--border))]">
                {labels.colProduct}
              </th>
              <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 px-3 py-2.5 text-start font-semibold border-b border-border/80 shadow-[0_1px_0_0_hsl(var(--border))]">
                {labels.colSp}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {list.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-muted-foreground text-sm" colSpan={8}>
                  {labels.detailNone}
                </td>
              </tr>
            ) : (
              sortedList.map((d, i) => {
                const rk = `${d.invoice_ref}__${d.client_name}__${d.product_name}__${d.meters}__${i}`;
                const full = d.client_name;
                const short = primaryClientLabel(full);
                const expanded = Boolean(nameOpen[rk]);
                const canToggle = full !== "—" && full.trim() !== short.trim();
                return (
                  <tr key={rk} className="hover:bg-muted/35 transition-colors">
                    <td className="px-3 py-2 align-middle font-mono text-xs text-foreground/90">{d.invoice_ref}</td>
                    <td className="px-3 py-2 align-middle text-end tabular-nums text-foreground">
                      {d.kartelaQty > 0 ? d.kartelaQty.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 align-middle text-sm text-foreground/90 break-words max-w-[10rem]">{d.branch}</td>
                    <td className="px-3 py-2 align-middle text-sm text-foreground/90 whitespace-nowrap">{d.dayDate}</td>
                    <td className="px-3 py-2 align-middle text-end tabular-nums font-medium text-foreground">
                      {d.meters.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex flex-col gap-1 items-start max-w-[14rem] sm:max-w-[18rem]">
                        <span className="text-sm text-foreground leading-snug break-words">
                          {expanded || !canToggle ? full : short}
                        </span>
                        {canToggle ? (
                          <button
                            type="button"
                            className="text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                            onClick={(e) => {
                              e.stopPropagation();
                              setNameOpen((p) => ({ ...p, [rk]: !p[rk] }));
                            }}
                          >
                            {expanded ? labels.collapseName : labels.expandName}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-middle text-sm text-foreground/90 break-words max-w-[12rem]">{d.product_name}</td>
                    <td className="px-3 py-2 align-middle text-xs text-muted-foreground leading-snug">{d.salesperson}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ComparisonPage() {
  const router = useRouter();
  const { locale, currentUser, salespersonId, filters } = useStore();
  const isRTL = locale === "ar";
  const months = isRTL ? MONTHS_AR : MONTHS_EN;

  const now = new Date();
  const currentYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const defaultYear = filters.selectedYear ?? currentYear;

  const [mode, setMode] = useState<CompareMode>("product");
  const [monthCount, setMonthCount] = useState<MonthCountMode>("three");
  const isThreeMonths = monthCount === "three";
  /** Default periods: January, February, March (same year). */
  const [period1, setPeriod1] = useState<Period>({ month: 1, year: defaultYear });
  const [period2, setPeriod2] = useState<Period>({ month: 2, year: defaultYear });
  const [period3, setPeriod3] = useState<Period>({ month: 3, year: defaultYear });
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [total1, setTotal1] = useState(0);
  const [total2, setTotal2] = useState(0);
  const [total3, setTotal3] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAutoLoadedRef = useRef(false);
  const detailRequestId = useRef(0);
  const [typeKind, setTypeKind] = useState<TypeKind>("all");
  const [typeValue, setTypeValue] = useState("");
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [typeOptionsLoading, setTypeOptionsLoading] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [detailLeft, setDetailLeft] = useState<DetailOrderRow[]>([]);
  const [detailMid, setDetailMid] = useState<DetailOrderRow[]>([]);
  const [detailRight, setDetailRight] = useState<DetailOrderRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const years = useMemo(() => Array.from({ length: 6 }, (_, i) => currentYear - 3 + i), [currentYear]);
  const spFilter = useMemo(
    () => (currentUser?.role === "sales" ? salespersonId ?? null : null),
    [currentUser?.role, salespersonId]
  );

  const t = {
    title: isRTL ? "مقارنة الأشهر" : "Month comparison",
    subtitle: isThreeMonths
      ? isRTL
        ? "قارن ثلاثة أشهر جنباً إلى جنب؛ الفرق والنمو بين كل شهرين متتاليين."
        : "Compare three months side by side. Change and growth appear between each pair of consecutive months."
      : isRTL
        ? "قارن شهرين؛ الفرق والنمو من الشهر الثاني مقابل الأول."
        : "Compare two months. Change and growth compare the second month to the first.",
    periodCount: isRTL ? "عدد الأشهر" : "Months to compare",
    twoMonths: isRTL ? "شهران" : "2 months",
    threeMonths: isRTL ? "ثلاثة أشهر" : "3 months",
    month1: isRTL ? "الشهر ١" : "Month 1",
    month2: isRTL ? "الشهر ٢" : "Month 2",
    month3: isRTL ? "الشهر ٣" : "Month 3",
    mode: isRTL ? "نوع المقارنة" : "Comparison type",
    run: isRTL ? "تنفيذ المقارنة" : "Run comparison",
    loading: isRTL ? "جارٍ تحميل المقارنة…" : "Loading comparison…",
    detailLoading: isRTL ? "جارٍ تحميل الطلبات…" : "Loading orders…",
    noData: isRTL ? "لا توجد بيانات للمقارنة" : "No data to compare",
    entity: isRTL ? "العنصر" : "Item",
    change: isRTL ? "الفرق" : "Change",
    growth: isRTL ? "النمو %" : "Growth %",
    total: isRTL ? "الإجمالي" : "Total",
    product: isRTL ? "حسب المنتج" : "By product",
    salesperson: isRTL ? "حسب المندوب" : "By salesperson",
    client: isRTL ? "حسب العميل" : "By client",
    kartela: isRTL ? "حسب الكارتيلا" : "By kartela",
    netProfit: isRTL ? "صافي الربح" : "Net profit",
    denied: isRTL ? "غير مصرح" : "Access denied",
    filterType: isRTL ? "تصفية حسب النوع" : "Filter by type",
    filterAll: isRTL ? "الكل (بدون تصفية)" : "All (no type filter)",
    filterCategory: isRTL ? "التصنيف" : "Category",
    filterPricelist: isRTL ? "قائمة الأسعار" : "Pricelist",
    filterCustomerType: isRTL ? "نوع العميل" : "Customer type",
    filterValue: isRTL ? "القيمة" : "Value",
    filterPick: isRTL ? "اختر القيمة" : "Choose a value",
    filterLoadingOpts: isRTL ? "جارٍ تحميل القيم…" : "Loading values…",
    filterNoValues: isRTL ? "لا توجد قيم" : "No values found",
    filterNeedValue: isRTL ? "اختر نوعاً ثم قيمةً ثم نفّذ المقارنة." : "Pick a type and value, then run comparison.",
    clickRowHint: isRTL ? "انقر على صف لعرض الطلبات التفصيلية (نفس التصفية والمقارنة)." : "Click a row to expand order lines (same filters and comparison mode).",
    detailOrders: isRTL ? "الطلبات" : "Orders",
    detailNone: isRTL ? "لا توجد طلبات لهذا الصف في هذه الفترة." : "No order lines for this item in this period.",
    detailLoadErr: isRTL ? "تعذر تحميل التفاصيل" : "Could not load details",
    colInvoice: isRTL ? "مرجع الفاتورة" : "Invoice",
    colKartela: isRTL ? "كارتيلا" : "Kartela",
    colBranch: isRTL ? "الفرع" : "Branch",
    colDayDate: isRTL ? "التاريخ (يوم)" : "Date (day)",
    colMeters: isRTL ? "الأمتار" : "Meters",
    colClient: isRTL ? "العميل" : "Client",
    colProduct: isRTL ? "المنتج" : "Product",
    colSp: isRTL ? "المندوب" : "Salesperson",
    expandName: isRTL ? "عرض الاسم كاملاً" : "Show full name",
    collapseName: isRTL ? "إخفاء" : "Hide",
  };

  const modeLabel = (value: CompareMode) => {
    if (value === "product") return t.product;
    if (value === "salesperson") return t.salesperson;
    if (value === "client") return t.client;
    if (value === "kartela") return t.kartela;
    return t.netProfit;
  };

  useEffect(() => {
    let cancelled = false;
    if (typeKind === "all") {
      setTypeOptions([]);
      setTypeValue("");
      setTypeOptionsLoading(false);
      return;
    }
    setTypeValue("");
    setTypeOptions([]);
    setTypeOptionsLoading(true);
    void (async () => {
      const supabase = createClient();
      try {
        if (typeKind === "category" || typeKind === "pricelist") {
          const col = typeKind === "category" ? "category" : "pricelist";
          const { data, error } = await supabase.from("orders").select(col).not(col, "is", null).limit(8000);
          if (cancelled || error) return;
          const s = new Set<string>();
          for (const r of (data ?? []) as Record<string, string | null>[]) {
            const v = String(r[col] ?? "").trim();
            if (v) s.add(v);
          }
          if (!cancelled) setTypeOptions(Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
        } else if (typeKind === "customer_type") {
          // Fixed allowlist (same as dashboard / clients) — DB scan is empty under RLS or when types are unset.
          if (!cancelled) setTypeOptions([...ALLOWED_CUSTOMER_TYPES]);
        }
      } finally {
        if (!cancelled) setTypeOptionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [typeKind]);

  useEffect(() => {
    detailRequestId.current += 1;
    setExpandedKey(null);
    setDetailLeft([]);
    setDetailMid([]);
    setDetailRight([]);
    setDetailError(null);
    setDetailLoading(false);
  }, [mode, monthCount, period1.month, period1.year, period2.month, period2.year, period3.month, period3.year, typeKind, typeValue]);

  const toggleDetailRow = useCallback(
    async (row: CompareRow) => {
      if (expandedKey === row.key) {
        detailRequestId.current += 1;
        setExpandedKey(null);
        setDetailLeft([]);
        setDetailMid([]);
        setDetailRight([]);
        setDetailError(null);
        setDetailLoading(false);
        return;
      }
      const myId = ++detailRequestId.current;
      setExpandedKey(row.key);
      setDetailLoading(true);
      setDetailError(null);
      setDetailLeft([]);
      setDetailMid([]);
      setDetailRight([]);
      try {
        const supabase = createClient();
        if (monthCount === "three") {
          const [dL, dM, dR] = await Promise.all([
            fetchOrderLinesForLine(supabase, period1, mode, row.key, typeKind, typeValue, spFilter, isRTL),
            fetchOrderLinesForLine(supabase, period2, mode, row.key, typeKind, typeValue, spFilter, isRTL),
            fetchOrderLinesForLine(supabase, period3, mode, row.key, typeKind, typeValue, spFilter, isRTL),
          ]);
          if (detailRequestId.current !== myId) return;
          setDetailLeft(dL);
          setDetailMid(dM);
          setDetailRight(dR);
        } else {
          const [dL, dR] = await Promise.all([
            fetchOrderLinesForLine(supabase, period1, mode, row.key, typeKind, typeValue, spFilter, isRTL),
            fetchOrderLinesForLine(supabase, period2, mode, row.key, typeKind, typeValue, spFilter, isRTL),
          ]);
          if (detailRequestId.current !== myId) return;
          setDetailLeft(dL);
          setDetailMid([]);
          setDetailRight(dR);
        }
      } catch (e) {
        if (detailRequestId.current === myId) {
          setDetailError(e instanceof Error ? e.message : "Failed");
        }
      } finally {
        if (detailRequestId.current === myId) {
          setDetailLoading(false);
        }
      }
    },
    [expandedKey, monthCount, period1, period2, period3, mode, typeKind, typeValue, spFilter, isRTL]
  );

  const loadPeriodMap = useCallback(
    async (period: Period, selectedMode: CompareMode, tk: TypeKind, tv: string): Promise<Map<string, number>> => {
    const supabase = createClient();
    const spFilter = currentUser?.role === "sales" ? salespersonId : null;
    const useOrderSource = tk !== "all" && tv.trim() !== "";

    if (useOrderSource) {
      const rows = await fetchOrdersForComparisonPeriod(supabase, period, tk, tv, spFilter);
      return aggregateOrderRows(rows, selectedMode, isRTL);
    }

    if (selectedMode === "product") {
      let q = supabase
        .from("product_analytics")
        .select("product_name, total_meters, month, year, salesperson_id")
        .eq("month", period.month)
        .eq("year", period.year);
      if (spFilter) q = q.eq("salesperson_id", spFilter);
      else q = q.is("salesperson_id", null);
      const { data, error: qErr } = await q;
      if (qErr) throw new Error(qErr.message);
      const out = new Map<string, number>();
      for (const row of (data ?? []) as any[]) {
        const key = String(row.product_name ?? "").trim();
        if (!key) continue;
        out.set(key, (out.get(key) ?? 0) + (Number(row.total_meters) || 0));
      }
      return out;
    }

    if (selectedMode === "salesperson") {
      let q = supabase
        .from("salesperson_performance")
        .select("salesperson_id, salesperson_name, total_meters, month, year")
        .eq("month", period.month)
        .eq("year", period.year);
      if (spFilter) q = q.eq("salesperson_id", spFilter);
      const { data, error: qErr } = await q;
      if (qErr) throw new Error(qErr.message);
      const out = new Map<string, number>();
      for (const row of (data ?? []) as any[]) {
        const key = String(row.salesperson_name ?? row.salesperson_id ?? "").trim();
        if (!key) continue;
        out.set(key, (out.get(key) ?? 0) + (Number(row.total_meters) || 0));
      }
      return out;
    }

    if (selectedMode === "client") {
      let q = supabase
        .from("client_monthly_metrics")
        .select("client_id, client_name, total_meters, month, year, salesperson_id")
        .eq("month", period.month)
        .eq("year", period.year);
      if (spFilter) q = q.eq("salesperson_id", spFilter);
      const { data, error: qErr } = await q;
      if (qErr) throw new Error(qErr.message);
      const out = new Map<string, number>();
      for (const row of (data ?? []) as any[]) {
        const key = String(row.client_name ?? row.client_id ?? "").trim();
        if (!key) continue;
        out.set(key, (out.get(key) ?? 0) + (Number(row.total_meters) || 0));
      }
      return out;
    }

    if (selectedMode === "kartela") {
      let q = supabase
        .from("client_monthly_metrics")
        .select("client_id, client_name, cartela_count, month, year, salesperson_id")
        .eq("month", period.month)
        .eq("year", period.year);
      if (spFilter) q = q.eq("salesperson_id", spFilter);
      const { data, error: qErr } = await q;
      if (qErr) throw new Error(qErr.message);
      const out = new Map<string, number>();
      for (const row of (data ?? []) as any[]) {
        const key = String(row.client_name ?? row.client_id ?? "").trim();
        if (!key) continue;
        out.set(key, (out.get(key) ?? 0) + (Number((row as any).cartela_count) || 0));
      }
      return out;
    }

    let q = supabase
      .from("client_monthly_metrics")
      .select("total_revenue, month, year, salesperson_id")
      .eq("month", period.month)
      .eq("year", period.year);
    if (spFilter) q = q.eq("salesperson_id", spFilter);
    const { data, error: qErr } = await q;
    if (qErr) throw new Error(qErr.message);
    const total = ((data ?? []) as any[]).reduce((sum, row) => sum + (Number((row as any).total_revenue) || 0), 0);
    return new Map<string, number>([[isRTL ? "صافي الربح" : "Net Profit", total]]);
  },
    [currentUser?.role, isRTL, salespersonId]
  );

  const runComparison = useCallback(async () => {
    if (!currentUser) return;
    const cacheKey = `comparison_v5_${monthCount}:${mode}:${period1.year}-${period1.month}:${period2.year}-${period2.month}:${period3.year}-${period3.month}:${currentUser.role}:${salespersonId ?? "all"}:${locale}:t:${typeKind}:${typeValue.trim()}`;
    const cached = dataCache.get<{
      rows: CompareRow[];
      total1: number;
      total2: number;
      total3: number;
    }>(cacheKey);
    if (cached) {
      setRows(cached.rows);
      setTotal1(cached.total1);
      setTotal2(cached.total2);
      setTotal3(cached.total3);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (monthCount === "two") {
        const [map1, map2] = await Promise.all([
          loadPeriodMap(period1, mode, typeKind, typeValue),
          loadPeriodMap(period2, mode, typeKind, typeValue),
        ]);
        const keys = new Set<string>([...Array.from(map1.keys()), ...Array.from(map2.keys())]);
        const merged: CompareRow[] = [];
        keys.forEach((key) => {
          const l = map1.get(key) ?? 0;
          const r = map2.get(key) ?? 0;
          merged.push({
            key,
            left: l,
            mid: 0,
            right: r,
            diff12: r - l,
            growth12: growthPct(r, l),
            diff23: 0,
            growth23: 0,
          });
        });
        merged.sort((a, b) => Math.max(b.left, b.right) - Math.max(a.left, a.right));
        setRows(merged);
        const t1 = merged.reduce((sum, item) => sum + item.left, 0);
        const t2 = merged.reduce((sum, item) => sum + item.right, 0);
        setTotal1(t1);
        setTotal2(t2);
        setTotal3(0);
        dataCache.set(cacheKey, { rows: merged, total1: t1, total2: t2, total3: 0 });
      } else {
        const [map1, map2, map3] = await Promise.all([
          loadPeriodMap(period1, mode, typeKind, typeValue),
          loadPeriodMap(period2, mode, typeKind, typeValue),
          loadPeriodMap(period3, mode, typeKind, typeValue),
        ]);
        const keys = new Set<string>([
          ...Array.from(map1.keys()),
          ...Array.from(map2.keys()),
          ...Array.from(map3.keys()),
        ]);
        const merged: CompareRow[] = [];
        keys.forEach((key) => {
          const l = map1.get(key) ?? 0;
          const m = map2.get(key) ?? 0;
          const r = map3.get(key) ?? 0;
          merged.push({
            key,
            left: l,
            mid: m,
            right: r,
            diff12: m - l,
            growth12: growthPct(m, l),
            diff23: r - m,
            growth23: growthPct(r, m),
          });
        });
        merged.sort((a, b) => Math.max(b.left, b.mid, b.right) - Math.max(a.left, a.mid, a.right));
        setRows(merged);
        const t1 = merged.reduce((sum, item) => sum + item.left, 0);
        const t2 = merged.reduce((sum, item) => sum + item.mid, 0);
        const t3 = merged.reduce((sum, item) => sum + item.right, 0);
        setTotal1(t1);
        setTotal2(t2);
        setTotal3(t3);
        dataCache.set(cacheKey, { rows: merged, total1: t1, total2: t2, total3: t3 });
      }
    } catch (e: unknown) {
      setRows([]);
      setTotal1(0);
      setTotal2(0);
      setTotal3(0);
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [currentUser, monthCount, period1, period2, period3, mode, typeKind, typeValue, loadPeriodMap]);

  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.role !== "admin" && currentUser.role !== "sales") {
      router.push("/dashboard");
      return;
    }
    if (hasAutoLoadedRef.current) return;
    hasAutoLoadedRef.current = true;
    void runComparison();
  }, [currentUser, router, runComparison]);

  if (currentUser && currentUser.role !== "admin" && currentUser.role !== "sales") {
    return <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">{t.denied}</div>;
  }

  return (
    <div className="space-y-5">
      <PageBack locale={locale} fallbackHref="/dashboard" />

      <div>
        <h1 className="text-2xl font-bold">{t.title}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t.subtitle}</p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t.mode}</label>
                <Select value={mode} onValueChange={(v) => setMode(v as CompareMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modeOptions.map((m) => (
                      <SelectItem key={m} value={m}>
                        {modeLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t.periodCount}</label>
                <Select
                  value={monthCount}
                  onValueChange={(v) => setMonthCount(v as MonthCountMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="two">{t.twoMonths}</SelectItem>
                    <SelectItem value="three">{t.threeMonths}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className={`grid gap-4 ${isThreeMonths ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              <div className="space-y-2 rounded-xl border border-border/80 bg-muted/20 p-3">
                <label className="text-sm font-medium">{t.month1}</label>
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={period1.month.toString()}
                    onValueChange={(v) => setPeriod1((p) => ({ ...p, month: Number(v) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((m, idx) => (
                        <SelectItem key={idx + 1} value={(idx + 1).toString()}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={period1.year.toString()}
                    onValueChange={(v) => setPeriod1((p) => ({ ...p, year: Number(v) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y} value={y.toString()}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-border/80 bg-muted/20 p-3">
                <label className="text-sm font-medium">{t.month2}</label>
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={period2.month.toString()}
                    onValueChange={(v) => setPeriod2((p) => ({ ...p, month: Number(v) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((m, idx) => (
                        <SelectItem key={idx + 1} value={(idx + 1).toString()}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={period2.year.toString()}
                    onValueChange={(v) => setPeriod2((p) => ({ ...p, year: Number(v) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y} value={y.toString()}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isThreeMonths ? (
                <div className="space-y-2 rounded-xl border border-border/80 bg-muted/20 p-3">
                  <label className="text-sm font-medium">{t.month3}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={period3.month.toString()}
                      onValueChange={(v) => setPeriod3((p) => ({ ...p, month: Number(v) }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {months.map((m, idx) => (
                          <SelectItem key={idx + 1} value={(idx + 1).toString()}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={period3.year.toString()}
                      onValueChange={(v) => setPeriod3((p) => ({ ...p, year: Number(v) }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y} value={y.toString()}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t.filterType}</label>
              <Select
                value={typeKind}
                onValueChange={(v) => {
                  setTypeKind(v as TypeKind);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.filterAll}</SelectItem>
                  <SelectItem value="category">{t.filterCategory}</SelectItem>
                  <SelectItem value="pricelist">{t.filterPricelist}</SelectItem>
                  <SelectItem value="customer_type">{t.filterCustomerType}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t.filterValue}</label>
              <Select
                key={typeKind}
                value={typeValue || undefined}
                onValueChange={(v) => setTypeValue(v)}
                disabled={typeKind === "all" || typeOptionsLoading || typeOptions.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={typeKind === "all" ? "—" : t.filterPick} />
                </SelectTrigger>
                <SelectContent>
                  {typeOptionsLoading ? (
                    <SelectItem value="__loading" disabled>
                      {t.filterLoadingOpts}
                    </SelectItem>
                  ) : typeKind !== "all" && typeOptions.length === 0 ? (
                    <SelectItem value="__empty" disabled>
                      {t.filterNoValues}
                    </SelectItem>
                  ) : (
                    typeOptions.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          {typeKind !== "all" && !typeValue.trim() && (
            <p className="text-xs text-muted-foreground">{t.filterNeedValue}</p>
          )}

          <Button
            className="gap-2"
            onClick={() => void runComparison()}
            disabled={loading || (typeKind !== "all" && !typeValue.trim())}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t.run}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className={`grid gap-4 ${isThreeMonths ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              {t.month1} · {months[period1.month - 1]} {period1.year}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{formatNumber(Math.round(total1))}</p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              {t.month2} · {months[period2.month - 1]} {period2.year}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{formatNumber(Math.round(total2))}</p>
          </CardContent>
        </Card>
        {isThreeMonths ? (
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">
                {t.month3} · {months[period3.month - 1]} {period3.year}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{formatNumber(Math.round(total3))}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-14 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>{t.loading}</span>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-14 text-center text-muted-foreground">{t.noData}</CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <p className="text-xs text-muted-foreground px-3 py-2 border-b border-border bg-muted/20">{t.clickRowHint}</p>
            <div className="max-h-[min(70vh,720px)] overflow-auto overscroll-contain" dir={isRTL ? "rtl" : "ltr"}>
              <table
                className={`w-full text-sm border-separate border-spacing-0 border border-border ${isThreeMonths ? "min-w-[1400px]" : "min-w-[800px]"}`}
              >
                <thead>
                  <tr>
                    <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 border border-border p-3 text-start font-semibold w-8 shadow-[0_1px_0_0_hsl(var(--border))]" aria-hidden />
                    <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 border border-border p-3 text-start font-semibold shadow-[0_1px_0_0_hsl(var(--border))]">{t.entity}</th>
                    <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 border border-border p-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))]">{months[period1.month - 1]} {period1.year}</th>
                    {isThreeMonths ? (
                      <>
                        <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 border border-border p-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))]">{t.change}</th>
                        <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 border border-border p-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))]">{t.growth}</th>
                        <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 border border-border p-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))]">{months[period2.month - 1]} {period2.year}</th>
                        <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 border border-border p-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))]">{t.change}</th>
                        <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 border border-border p-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))]">{t.growth}</th>
                        <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 border border-border p-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))]">{months[period3.month - 1]} {period3.year}</th>
                      </>
                    ) : (
                      <>
                        <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 border border-border p-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))]">{months[period2.month - 1]} {period2.year}</th>
                        <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 border border-border p-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))]">{t.change}</th>
                        <th className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 border border-border p-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))]">{t.growth}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const positive12 = row.diff12 >= 0;
                    const positive23 = row.diff23 >= 0;
                    const open = expandedKey === row.key;
                    const detailLabels: DetailTableLabels = {
                      detailOrders: t.detailOrders,
                      detailNone: t.detailNone,
                      colInvoice: t.colInvoice,
                      colKartela: t.colKartela,
                      colBranch: t.colBranch,
                      colDayDate: t.colDayDate,
                      colMeters: t.colMeters,
                      colClient: t.colClient,
                      colProduct: t.colProduct,
                      colSp: t.colSp,
                      expandName: t.expandName,
                      collapseName: t.collapseName,
                    };
                    return (
                      <Fragment key={row.key}>
                        <tr
                          className={`hover:bg-muted/30 cursor-pointer transition-colors ${open ? "bg-muted/25" : ""}`}
                          onClick={() => void toggleDetailRow(row)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              void toggleDetailRow(row);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-expanded={open}
                        >
                          <td className="border border-border p-2 text-muted-foreground w-8">
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="border border-border p-3 font-medium">{row.key}</td>
                          <td className="border border-border p-3 text-end tabular-nums">{Math.round(row.left).toLocaleString()}</td>
                          {isThreeMonths ? (
                            <>
                              <td className={`border border-border p-3 text-end tabular-nums font-semibold ${positive12 ? "text-green-600" : "text-red-600"}`}>
                                {positive12 ? "+" : ""}
                                {Math.round(row.diff12).toLocaleString()}
                              </td>
                              <td className={`border border-border p-3 text-end tabular-nums font-semibold ${positive12 ? "text-green-600" : "text-red-600"}`}>
                                <span className="inline-flex items-center gap-1">
                                  {positive12 ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                                  {row.growth12.toFixed(1)}%
                                </span>
                              </td>
                              <td className="border border-border p-3 text-end tabular-nums">{Math.round(row.mid).toLocaleString()}</td>
                              <td className={`border border-border p-3 text-end tabular-nums font-semibold ${positive23 ? "text-green-600" : "text-red-600"}`}>
                                {positive23 ? "+" : ""}
                                {Math.round(row.diff23).toLocaleString()}
                              </td>
                              <td className={`border border-border p-3 text-end tabular-nums font-semibold ${positive23 ? "text-green-600" : "text-red-600"}`}>
                                <span className="inline-flex items-center gap-1">
                                  {positive23 ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                                  {row.growth23.toFixed(1)}%
                                </span>
                              </td>
                              <td className="border border-border p-3 text-end tabular-nums">{Math.round(row.right).toLocaleString()}</td>
                            </>
                          ) : (
                            <>
                              <td className="border border-border p-3 text-end tabular-nums">{Math.round(row.right).toLocaleString()}</td>
                              <td className={`border border-border p-3 text-end tabular-nums font-semibold ${positive12 ? "text-green-600" : "text-red-600"}`}>
                                {positive12 ? "+" : ""}
                                {Math.round(row.diff12).toLocaleString()}
                              </td>
                              <td className={`border border-border p-3 text-end tabular-nums font-semibold ${positive12 ? "text-green-600" : "text-red-600"}`}>
                                <span className="inline-flex items-center gap-1">
                                  {positive12 ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                                  {row.growth12.toFixed(1)}%
                                </span>
                              </td>
                            </>
                          )}
                        </tr>
                        {open && (
                          <tr className="bg-muted/15">
                            <td colSpan={isThreeMonths ? 9 : 6} className="border border-border p-3 align-top">
                              {detailLoading ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  <span>{t.detailLoading}</span>
                                </div>
                              ) : detailError ? (
                                <p className="text-sm text-destructive">
                                  {t.detailLoadErr}: {detailError}
                                </p>
                              ) : (
                                <div className="scrollbar-thin w-full max-w-full overflow-x-auto overflow-y-visible rounded-lg border border-border/50 bg-muted/10 p-2">
                                  <div className="flex min-w-[min(100%,840px)] flex-row flex-nowrap items-stretch gap-3">
                                    <div className="min-w-[260px] flex-1 basis-0">
                                      <ComparisonOrderDetailTable
                                        key={`d1-${row.key}`}
                                        list={detailLeft}
                                        periodLabel={`${months[period1.month - 1]} ${period1.year}`}
                                        labels={detailLabels}
                                        isRTL={isRTL}
                                      />
                                    </div>
                                    {isThreeMonths ? (
                                      <div className="min-w-[260px] flex-1 basis-0">
                                        <ComparisonOrderDetailTable
                                          key={`d2-${row.key}`}
                                          list={detailMid}
                                          periodLabel={`${months[period2.month - 1]} ${period2.year}`}
                                          labels={detailLabels}
                                          isRTL={isRTL}
                                        />
                                      </div>
                                    ) : null}
                                    <div className="min-w-[260px] flex-1 basis-0">
                                      <ComparisonOrderDetailTable
                                        key={`d3-${row.key}`}
                                        list={detailRight}
                                        periodLabel={
                                          isThreeMonths
                                            ? `${months[period3.month - 1]} ${period3.year}`
                                            : `${months[period2.month - 1]} ${period2.year}`
                                        }
                                        labels={detailLabels}
                                        isRTL={isRTL}
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground px-3 py-2 border-t border-border">
              {t.total}: {rows.length}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
