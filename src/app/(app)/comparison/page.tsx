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

type CompareMode = "product" | "salesperson" | "client" | "kartela" | "net-profit";
type Period = { month: number; year: number };
type CompareRow = { key: string; left: number; right: number; diff: number; growth: number };
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

function isKartelaProductName(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  if (lower.includes("kartela") || lower.includes("cartela")) return true;
  return name.includes("كارتيلا");
}

function aggregateOrderRows(rows: OrderJoinRow[], mode: CompareMode, isRTL: boolean): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const pName = row.products?.name;
    const isK = isKartelaProductName(pName);
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
};

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
  "invoice_ref, quantity, products(name), clients(name), salespersons(name, code)";
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
    .filter((r: { name: string | null }) => isKartelaProductName(r.name))
    .map((r: { id: string }) => r.id);
  kartelaProductIdCache = { ids, at: Date.now() };
  return ids;
}

function mapOrderRawToDetail(r: any): DetailOrderRow {
  const p = Array.isArray(r.products) ? r.products[0] : r.products;
  const c = Array.isArray(r.clients) ? r.clients[0] : r.clients;
  const sp = Array.isArray(r.salespersons) ? r.salespersons[0] : r.salespersons;
  const productName = p?.name ?? null;
  const clientName = c?.name ?? null;
  const namePart = cellDisplay(sp?.name);
  const codePart = cellDisplay(sp?.code);
  const spLine =
    namePart === "—" && codePart === "—" ? "—" : codePart === "—" ? namePart : `${namePart} (${codePart})`;
  return {
    invoice_ref: cellDisplay(r.invoice_ref),
    meters: Math.round(Number(r.quantity)) || 0,
    client_name: cellDisplay(clientName),
    product_name: cellDisplay(productName),
    salesperson: spLine,
  };
}

async function paginateOrderDetailQuery(
  runRange: (from: number, to: number) => any,
  maxRows: number
): Promise<DetailOrderRow[]> {
  const out: DetailOrderRow[] = [];
  let from = 0;
  while (out.length < maxRows) {
    const to = from + DETAIL_PAGE - 1;
    const { data, error } = await runRange(from, to);
    if (error) throw new Error(error.message);
    const raw = (data ?? []) as any[];
    for (const r of raw) {
      out.push(mapOrderRawToDetail(r));
      if (out.length >= maxRows) return out;
    }
    if (raw.length < DETAIL_PAGE) break;
    from += DETAIL_PAGE;
  }
  return out;
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
    ? "invoice_ref, quantity, products(name), clients!inner(name, customer_type), salespersons(name, code)"
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
      <div className="overflow-x-auto max-h-[min(50vh,22rem)] overscroll-contain">
        <table className="w-full min-w-[560px] text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/75">
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 text-start font-semibold border-b border-border/80">{labels.colInvoice}</th>
              <th className="px-3 py-2.5 text-end font-semibold border-b border-border/80 whitespace-nowrap">{labels.colMeters}</th>
              <th className="px-3 py-2.5 text-start font-semibold border-b border-border/80 min-w-[8rem]">{labels.colClient}</th>
              <th className="px-3 py-2.5 text-start font-semibold border-b border-border/80">{labels.colProduct}</th>
              <th className="px-3 py-2.5 text-start font-semibold border-b border-border/80">{labels.colSp}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {list.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-muted-foreground text-sm" colSpan={5}>
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
  const currentMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const currentYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const defaultLeftMonth = filters.selectedMonth ?? currentMonth;
  const defaultLeftYear = filters.selectedYear ?? currentYear;
  const defaultRightMonth = defaultLeftMonth === 12 ? 1 : defaultLeftMonth + 1;
  const defaultRightYear = defaultLeftMonth === 12 ? defaultLeftYear + 1 : defaultLeftYear;

  const [mode, setMode] = useState<CompareMode>("product");
  const [left, setLeft] = useState<Period>({ month: defaultLeftMonth, year: defaultLeftYear });
  const [right, setRight] = useState<Period>({ month: defaultRightMonth, year: defaultRightYear });
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [leftTotal, setLeftTotal] = useState(0);
  const [rightTotal, setRightTotal] = useState(0);
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
  const [detailRight, setDetailRight] = useState<DetailOrderRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const years = useMemo(() => Array.from({ length: 6 }, (_, i) => currentYear - 3 + i), [currentYear]);
  const spFilter = useMemo(
    () => (currentUser?.role === "sales" ? salespersonId ?? null : null),
    [currentUser?.role, salespersonId]
  );

  const t = {
    title: isRTL ? "مقارنة شهرين" : "Month Comparison",
    subtitle: isRTL
      ? "قارن شهرين جنباً إلى جنب حسب المنتج أو المندوب أو العميل أو الكارتيلا أو صافي الربح."
      : "Compare two months side by side by product, salesperson, client, kartela, or net profit.",
    left: isRTL ? "الشهر الأول" : "Left month",
    right: isRTL ? "الشهر الثاني" : "Right month",
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
    setDetailRight([]);
    setDetailError(null);
    setDetailLoading(false);
  }, [mode, left.month, left.year, right.month, right.year, typeKind, typeValue]);

  const toggleDetailRow = useCallback(
    async (row: CompareRow) => {
      if (expandedKey === row.key) {
        detailRequestId.current += 1;
        setExpandedKey(null);
        setDetailLeft([]);
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
      setDetailRight([]);
      try {
        const supabase = createClient();
        const [dL, dR] = await Promise.all([
          fetchOrderLinesForLine(supabase, left, mode, row.key, typeKind, typeValue, spFilter, isRTL),
          fetchOrderLinesForLine(supabase, right, mode, row.key, typeKind, typeValue, spFilter, isRTL),
        ]);
        if (detailRequestId.current !== myId) return;
        setDetailLeft(dL);
        setDetailRight(dR);
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
    [expandedKey, left, right, mode, typeKind, typeValue, spFilter, isRTL]
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
    const cacheKey = `comparison_v1:${mode}:${left.year}-${left.month}:${right.year}-${right.month}:${currentUser.role}:${salespersonId ?? "all"}:${locale}:t:${typeKind}:${typeValue.trim()}`;
    const cached = dataCache.get<{ rows: CompareRow[]; leftTotal: number; rightTotal: number }>(cacheKey);
    if (cached) {
      setRows(cached.rows);
      setLeftTotal(cached.leftTotal);
      setRightTotal(cached.rightTotal);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [leftMap, rightMap] = await Promise.all([
        loadPeriodMap(left, mode, typeKind, typeValue),
        loadPeriodMap(right, mode, typeKind, typeValue),
      ]);
      const keys = new Set<string>([...Array.from(leftMap.keys()), ...Array.from(rightMap.keys())]);
      const merged: CompareRow[] = [];
      keys.forEach((key) => {
        const l = leftMap.get(key) ?? 0;
        const r = rightMap.get(key) ?? 0;
        const d = r - l;
        merged.push({ key, left: l, right: r, diff: d, growth: growthPct(r, l) });
      });
      merged.sort((a, b) => Math.max(b.left, b.right) - Math.max(a.left, a.right));
      setRows(merged);
      const leftAgg = merged.reduce((sum, item) => sum + item.left, 0);
      const rightAgg = merged.reduce((sum, item) => sum + item.right, 0);
      setLeftTotal(leftAgg);
      setRightTotal(rightAgg);
      dataCache.set(cacheKey, { rows: merged, leftTotal: leftAgg, rightTotal: rightAgg });
    } catch (e: unknown) {
      setRows([]);
      setLeftTotal(0);
      setRightTotal(0);
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [currentUser, left, right, mode, typeKind, typeValue, loadPeriodMap]);

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
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t.mode}</label>
              <Select value={mode} onValueChange={(v) => setMode(v as CompareMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {modeOptions.map((m) => (
                    <SelectItem key={m} value={m}>{modeLabel(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t.left}</label>
              <div className="grid grid-cols-2 gap-2">
                <Select value={left.month.toString()} onValueChange={(v) => setLeft((p) => ({ ...p, month: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {months.map((m, idx) => <SelectItem key={idx + 1} value={(idx + 1).toString()}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={left.year.toString()} onValueChange={(v) => setLeft((p) => ({ ...p, year: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t.right}</label>
              <div className="grid grid-cols-2 gap-2">
                <Select value={right.month.toString()} onValueChange={(v) => setRight((p) => ({ ...p, month: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {months.map((m, idx) => <SelectItem key={idx + 1} value={(idx + 1).toString()}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={right.year.toString()} onValueChange={(v) => setRight((p) => ({ ...p, year: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t.left} · {months[left.month - 1]} {left.year}</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatNumber(Math.round(leftTotal))}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t.right} · {months[right.month - 1]} {right.year}</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatNumber(Math.round(rightTotal))}</p></CardContent>
        </Card>
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
            <div className="overflow-x-auto" dir={isRTL ? "rtl" : "ltr"}>
              <table className="w-full min-w-[900px] text-sm border-collapse border border-border">
                <thead>
                  <tr className="bg-muted/70">
                    <th className="border border-border p-3 text-start font-semibold w-8" aria-hidden />
                    <th className="border border-border p-3 text-start font-semibold">{t.entity}</th>
                    <th className="border border-border p-3 text-end font-semibold">{months[left.month - 1]} {left.year}</th>
                    <th className="border border-border p-3 text-end font-semibold">{months[right.month - 1]} {right.year}</th>
                    <th className="border border-border p-3 text-end font-semibold">{t.change}</th>
                    <th className="border border-border p-3 text-end font-semibold">{t.growth}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const positive = row.diff >= 0;
                    const open = expandedKey === row.key;
                    const detailLabels: DetailTableLabels = {
                      detailOrders: t.detailOrders,
                      detailNone: t.detailNone,
                      colInvoice: t.colInvoice,
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
                          <td className="border border-border p-3 text-end tabular-nums">{Math.round(row.right).toLocaleString()}</td>
                          <td className={`border border-border p-3 text-end tabular-nums font-semibold ${positive ? "text-green-600" : "text-red-600"}`}>
                            {positive ? "+" : ""}
                            {Math.round(row.diff).toLocaleString()}
                          </td>
                          <td className={`border border-border p-3 text-end tabular-nums font-semibold ${positive ? "text-green-600" : "text-red-600"}`}>
                            <span className="inline-flex items-center gap-1">
                              {positive ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                              {row.growth.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-muted/15">
                            <td colSpan={6} className="border border-border p-3 align-top">
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
                                <div className="grid gap-4 md:grid-cols-2">
                                  <ComparisonOrderDetailTable
                                    key={`dl-${row.key}`}
                                    list={detailLeft}
                                    periodLabel={`${months[left.month - 1]} ${left.year}`}
                                    labels={detailLabels}
                                    isRTL={isRTL}
                                  />
                                  <ComparisonOrderDetailTable
                                    key={`dr-${row.key}`}
                                    list={detailRight}
                                    periodLabel={`${months[right.month - 1]} ${right.year}`}
                                    labels={detailLabels}
                                    isRTL={isRTL}
                                  />
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
