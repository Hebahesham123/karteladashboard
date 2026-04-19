"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronsUpDown,
  Layers,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Search,
  Table2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";
import { ALLOWED_CUSTOMER_TYPES } from "@/lib/customerTypes";
import { isKartelaProductName, kartelaFamilyBaseKey } from "@/lib/kartelaProduct";
import { fetchDistinctCategoriesAndPricelists } from "@/lib/orderImportMeta";
import { FilterBar } from "@/components/shared/FilterBar";
import { PageBack } from "@/components/layout/PageBack";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
interface MatchRow {
  clientId: string;
  name: string;
  partnerId: string;
  salespersonName: string | null;
  productName: string;
  category: string | null;
  quantity: number;
  invoiceTotal: number;
  unitPrice: number;
  invoiceRef: string;
  pricelist: string | null;
  /** Odoo / import branch for this line */
  branch: string | null;
  /** YYYY-MM-DD from invoice_date or created_at */
  lineDate: string;
  /** Sum of كارتله quantities for same client × fabric family in this month */
  kartelaQty: number;
}

const CAT_PLACEHOLDER = "__pick_category__";
const PL_ANY = "__any_pricelist__";
const DEFAULT_PRICE_RANGE = 50;

function unitPriceMatchesTarget(unitPrice: number, target: number, range: number): boolean {
  const u = Math.round(unitPrice * 100) / 100;
  const t = Math.round(target * 100) / 100;
  return Math.abs(u - t) <= range;
}

/** Match invoice refs across lines (Odoo often repeats ref on every line). */
function normalizeInvoiceKey(ref: string): string {
  return ref.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * When explicit كارتله product rows are missing, some uploads only store cartela in meter_breakdown labels.
 */
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

function productNameFromRow(row: { products?: { name?: string } | null }): string | null {
  const p = row.products as { name?: string } | { name?: string }[] | null | undefined;
  if (!p) return null;
  if (Array.isArray(p)) return p[0]?.name ?? null;
  return p.name ?? null;
}

export default function ClientsByCategoryPricePage() {
  const router = useRouter();
  const { locale, filters, currentUser, salespersonId } = useStore();
  const isRTL = locale === "ar";

  const [selectedCategory, setSelectedCategory] = useState<string>(CAT_PLACEHOLDER);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [selectedPricelist, setSelectedPricelist] = useState<string>(PL_ANY);
  const [pricelistOptions, setPricelistOptions] = useState<string[]>([]);
  const [priceInput, setPriceInput] = useState("");
  const [priceRangeInput, setPriceRangeInput] = useState(String(DEFAULT_PRICE_RANGE));
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [pricelistOpen, setPricelistOpen] = useState(false);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [distinctLoadError, setDistinctLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const month = filters.selectedMonth;
  const year = filters.selectedYear;

  const selectedSpIds = useMemo(() => {
    const selectedSalespersons = filters.selectedSalespersons ?? [];
    if (currentUser?.role === "sales") return salespersonId ? [salespersonId] : [];
    if (selectedSalespersons.length > 0) return selectedSalespersons;
    if (salespersonId) return [salespersonId];
    if (filters.selectedSalesperson) return [filters.selectedSalesperson];
    return [];
  }, [currentUser?.role, salespersonId, filters.selectedSalesperson, filters.selectedSalespersons]);

  const loadCategories = useCallback(async (opts?: { showLoading?: boolean }) => {
    if (!currentUser) return;
    const showLoading = opts?.showLoading ?? false;
    if (showLoading) setLoadingCategories(true);
    setDistinctLoadError(null);
    const m = filters.selectedMonth ?? new Date().getMonth() + 1;
    const y = filters.selectedYear ?? new Date().getFullYear();
    const directDistinctFromOrders = async () => {
      const supabase = createClient();
      const catSet = new Set<string>();
      const plSet = new Set<string>();
      let from = 0;
      const PAGE = 1000;
      for (;;) {
        let q = supabase
          .from("orders")
          .select("category, pricelist")
          .eq("month", m)
          .eq("year", y)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (selectedSpIds.length === 1) q = q.eq("salesperson_id", selectedSpIds[0]);
        else if (selectedSpIds.length > 1) q = q.in("salesperson_id", selectedSpIds);

        const { data, error } = await q;
        if (error || !data?.length) break;
        for (const r of data as { category?: string | null; pricelist?: string | null }[]) {
          const c = String(r.category ?? "").trim();
          if (c) catSet.add(c);
          const p = String(r.pricelist ?? "").trim();
          if (p) plSet.add(p);
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return { categories: Array.from(catSet), pricelists: Array.from(plSet) };
    };
    try {
      const res = await fetch(`/api/order-distinct-filters?month=${m}&year=${y}`, { credentials: "include" });
      const json = (await res.json()) as {
        categories?: string[];
        pricelists?: string[];
        error?: string | null;
      };
      if (!res.ok) {
        const msg = json.error || `HTTP ${res.status}`;
        setDistinctLoadError(msg);
        const supabase = createClient();
        const fb = await fetchDistinctCategoriesAndPricelists(supabase, { month: m, year: y, maxPages: 500 });
        if (fb.error) setDistinctLoadError(`${msg} · ${fb.error}`);
        if (fb.categories.length || fb.pricelists.length) {
          setCategoryOptions(fb.categories);
          setPricelistOptions(fb.pricelists);
          return;
        }
        const direct = await directDistinctFromOrders();
        setCategoryOptions(direct.categories);
        setPricelistOptions(direct.pricelists);
        return;
      }
      if (json.error) setDistinctLoadError(json.error);
      const apiCats = json.categories ?? [];
      const apiPls = json.pricelists ?? [];

      // Guard against stale/empty API responses: verify once directly from DB.
      if (apiCats.length === 0 && apiPls.length === 0) {
        const supabase = createClient();
        const fb = await fetchDistinctCategoriesAndPricelists(supabase, { month: m, year: y, maxPages: 500 });
        if (fb.categories.length > 0 || fb.pricelists.length > 0) {
          setCategoryOptions(fb.categories);
          setPricelistOptions(fb.pricelists);
          setDistinctLoadError(fb.error ?? null);
          return;
        }
        if (fb.error) setDistinctLoadError(fb.error);
        const direct = await directDistinctFromOrders();
        if (direct.categories.length > 0 || direct.pricelists.length > 0) {
          setCategoryOptions(direct.categories);
          setPricelistOptions(direct.pricelists);
          setDistinctLoadError(null);
          return;
        }
      }

      setCategoryOptions(apiCats);
      setPricelistOptions(apiPls);
    } catch (err) {
      const base = err instanceof Error ? err.message : "Failed to load";
      setDistinctLoadError(base);
      try {
        const supabase = createClient();
        const fb = await fetchDistinctCategoriesAndPricelists(supabase, { month: m, year: y, maxPages: 500 });
        setCategoryOptions(fb.categories);
        setPricelistOptions(fb.pricelists);
        if (fb.error) setDistinctLoadError(`${base} · ${fb.error}`);
      } catch {
        setCategoryOptions([]);
        setPricelistOptions([]);
      }
    } finally {
      if (showLoading) setLoadingCategories(false);
    }
  }, [currentUser, filters.selectedMonth, filters.selectedYear, selectedSpIds]);

  useEffect(() => {
    void loadCategories({ showLoading: false });
  }, [loadCategories]);

  const runSearch = useCallback(async () => {
    if (!currentUser) return;
    if (currentUser.role === "sales" && !salespersonId) {
      setMatches([]);
      setHasSearched(true);
      return;
    }

    if (selectedCategory === CAT_PLACEHOLDER) {
      setError(isRTL ? "اختر التصنيف" : "Select a category");
      return;
    }
    const catNorm = selectedCategory.trim().toLowerCase();
    const plNorm = selectedPricelist === PL_ANY ? "" : selectedPricelist.trim().toLowerCase();

    const priceTrim = priceInput.trim();
    let targetPrice: number | null = null;
    let priceRange = DEFAULT_PRICE_RANGE;
    if (priceTrim !== "") {
      const n = Number(priceTrim.replace(/,/g, "."));
      if (Number.isNaN(n) || n < 0) {
        setError(isRTL ? "السعر غير صالح" : "Invalid price");
        return;
      }
      targetPrice = n;
      const r = Number(priceRangeInput.trim().replace(/,/g, "."));
      if (Number.isNaN(r) || r < 0) {
        setError(isRTL ? "مدى السعر غير صالح" : "Invalid price range");
        return;
      }
      priceRange = r;
    }

    setLoading(true);
    setError(null);
    setHasSearched(true);
    const supabase = createClient();

    try {
      let clientQuery = supabase
        .from("clients")
        .select("id, name, partner_id, salesperson_id")
        .in("customer_type", [...ALLOWED_CUSTOMER_TYPES]);

      if (selectedSpIds.length === 1) clientQuery = clientQuery.eq("salesperson_id", selectedSpIds[0]);
      else if (selectedSpIds.length > 1) clientQuery = clientQuery.in("salesperson_id", selectedSpIds);

      const { data: clientRows, error: clientErr } = await clientQuery;
      if (clientErr) throw new Error(clientErr.message);

      const { data: spRows } = await supabase.from("salespersons").select("id, name");
      const spNameById = new Map<string, string>(
        (spRows ?? []).map((s: { id: string; name?: string }) => [s.id, String(s.name ?? "")])
      );

      const clientMap = new Map(
        (clientRows ?? []).map((c: { id: string; name: string; partner_id: string; salesperson_id: string | null }) => {
          const sid = c.salesperson_id;
          return [
            c.id,
            {
              id: c.id,
              name: c.name,
              partner_id: c.partner_id,
              salespersonName: sid ? spNameById.get(sid) ?? null : null,
            },
          ];
        })
      );

      const selectedClientIds = filters.selectedClients?.length
        ? filters.selectedClients
        : filters.selectedClient
          ? [filters.selectedClient]
          : [];
      let allowedIds = Array.from(clientMap.keys());
      if (selectedClientIds.length > 0) {
        allowedIds = allowedIds.filter((id) => selectedClientIds.includes(id));
      }

      if (allowedIds.length === 0) {
        setMatches([]);
        return;
      }

      const orderRows: any[] = [];
      const CHUNK = 200;
      const CONCURRENCY = 6;
      const chunks: string[][] = [];
      for (let i = 0; i < allowedIds.length; i += CHUNK) {
        chunks.push(allowedIds.slice(i, i + CHUNK));
      }

      const fetchChunk = async (chunk: string[]) => {
        const q = supabase
          .from("orders")
          .select(
            "client_id, quantity, invoice_total, category, invoice_ref, pricelist, salesperson_id, branch, invoice_date, created_at, meter_breakdown, products(name)"
          )
          .eq("month", month)
          .eq("year", year)
          .in("client_id", chunk);
        const { data, error: oe } = await q;
        if (oe) throw new Error(oe.message);
        return data ?? [];
      };

      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const slice = chunks.slice(i, i + CONCURRENCY);
        const batch = await Promise.all(slice.map((chunk) => fetchChunk(chunk)));
        batch.forEach((rows) => orderRows.push(...rows));
      }

      const kartelaByClientBase = new Map<string, number>();
      for (const row of orderRows) {
        const pname = productNameFromRow(row);
        if (!pname || !isKartelaProductName(pname)) continue;
        const base = kartelaFamilyBaseKey(pname);
        const ck = `${row.client_id as string}|${base}`;
        kartelaByClientBase.set(ck, (kartelaByClientBase.get(ck) ?? 0) + (Number(row.quantity) || 0));
      }

      const branchByClientInvoice = new Map<string, string>();
      const branchByClient = new Map<string, string>();
      for (const row of orderRows) {
        const cid = row.client_id as string;
        const b = row.branch != null ? String(row.branch).trim() : "";
        if (!b) continue;
        if (!branchByClient.has(cid)) branchByClient.set(cid, b);
        const ir = String(row.invoice_ref ?? "").trim();
        if (ir) {
          const k = `${cid}|${normalizeInvoiceKey(ir)}`;
          if (!branchByClientInvoice.has(k)) branchByClientInvoice.set(k, b);
        }
      }

      const out: MatchRow[] = [];
      for (const row of orderRows) {
        const pname = productNameFromRow(row);
        if (!pname || isKartelaProductName(pname)) continue;
        const qty = Number(row.quantity) || 0;
        if (qty <= 0) continue;
        const inv = Number(row.invoice_total) || 0;
        const oc = String(row.category ?? "").trim().toLowerCase();
        if (oc !== catNorm) continue;
        if (plNorm) {
          const op = String(row.pricelist ?? "").trim().toLowerCase();
          if (op !== plNorm) continue;
        }
        const unitPrice = inv / qty;
        if (targetPrice != null && !unitPriceMatchesTarget(unitPrice, targetPrice, priceRange)) continue;

        const cid = row.client_id as string;
        const c = clientMap.get(cid);
        if (!c) continue;
        const sid = row.salesperson_id as string | null;
        const lineSp = sid ? spNameById.get(sid) ?? null : null;
        const baseKey = kartelaFamilyBaseKey(pname);
        let kartelaQty = kartelaByClientBase.get(`${cid}|${baseKey}`) ?? 0;
        if (kartelaQty <= 0) {
          kartelaQty = kartelaQtyFromMeterBreakdown((row as { meter_breakdown?: unknown }).meter_breakdown);
        }
        const irRef = String(row.invoice_ref ?? "").trim();
        let br = row.branch != null ? String(row.branch).trim() : "";
        if (!br && irRef) br = branchByClientInvoice.get(`${cid}|${normalizeInvoiceKey(irRef)}`) ?? "";
        if (!br) br = branchByClient.get(cid) ?? "";
        const lineDate =
          row.invoice_date != null && String(row.invoice_date).trim() !== ""
            ? String(row.invoice_date).trim().slice(0, 10)
            : row.created_at != null && String(row.created_at).trim() !== ""
              ? String(row.created_at).slice(0, 10)
              : "";
        out.push({
          clientId: cid,
          name: c.name,
          partnerId: c.partner_id,
          salespersonName: lineSp ?? c.salespersonName,
          productName: pname,
          category: row.category != null ? String(row.category) : null,
          quantity: qty,
          invoiceTotal: inv,
          unitPrice,
          invoiceRef: irRef,
          pricelist: row.pricelist != null ? String(row.pricelist).trim() : null,
          branch: br || null,
          lineDate,
          kartelaQty,
        });
      }

      out.sort((a, b) => {
        const du = a.unitPrice - b.unitPrice;
        if (du !== 0) return du;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
      setMatches(out);
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : isRTL ? "تعذر التحميل" : "Failed to load");
      setMatches([]);
    } finally {
      setLoading(false);
    }
  }, [
    currentUser,
    salespersonId,
    selectedSpIds,
    month,
    year,
    selectedCategory,
    selectedPricelist,
    priceInput,
    priceRangeInput,
    filters.selectedClient,
    filters.selectedClients,
    isRTL,
  ]);

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin" && currentUser.role !== "sales") {
      router.push("/dashboard");
    }
  }, [currentUser, router]);

  const t = {
    title: isRTL ? "عملاء حسب التصنيف والسعر" : "Clients by category & price",
    subtitle: isRTL
      ? "اختر التصنيف وقائمة الأسعار من البيانات المحمّلة؛ السعر (للمتر) اختياري — إن تركته فارغاً تُعرض كل الأسعار."
      : "Pick category and pricelist from imported data. Price (EGP/m) is optional — leave empty to show all unit prices.",
    category: isRTL ? "التصنيف" : "Category",
    categoryHint: isRTL ? "من الطلبات المحفوظة في النظام" : "From orders already in the system",
    search: isRTL ? "بحث" : "Search",
    refresh: isRTL ? "تحديث الاقتراحات" : "Refresh suggestions",
    partner: isRTL ? "الرقم" : "Partner",
    client: isRTL ? "العميل" : "Client",
    sp: isRTL ? "المندوب" : "Salesperson",
    product: isRTL ? "المنتج" : "Product",
    meters: isRTL ? "الأمتار" : "Meters",
    total: isRTL ? "الإجمالي" : "Total",
    unit: isRTL ? "سعر المتر" : "EGP/m",
    invoice: isRTL ? "فاتوره" : "Invoice",
    branch: isRTL ? "الفرع" : "Branch",
    dayDate: isRTL ? "تاريخ اليوم" : "Day",
    kartelaQty: isRTL ? "كمية كارتيلا" : "Kartela qty",
    filtersCardTitle: isRTL ? "معايير البحث" : "Search criteria",
    filtersCardDesc: isRTL ? "التصنيف مطلوب؛ باقي الحقول اختيارية." : "Category is required; other fields are optional.",
    resultsTitle: isRTL ? "نتائج الطلبات" : "Order lines",
    resultsHint: isRTL
      ? "الفرع يُستكمل من أي سطر لنفس الفاتورة إن كان فارغاً. الكارتيلا: من سطر منتج كارتيلا أو من تفصيل الألوان في الطلب."
      : "Branch is filled from any line with the same invoice if empty. Kartela: from كارتله product rows or color-line breakdown on the order.",
    pricelist: isRTL ? "قائمة الأسعار" : "Pricelist",
    pricelistHint: isRTL ? "اختياري — «الكل» لجميع قوائم الأسعار" : "Optional — “All” includes every pricelist",
    price: isRTL ? "السعر" : "Price",
    priceRange: isRTL ? "مدى السعر ±" : "Price range ±",
    priceHint: isRTL ? "سعر المتر بالجنيه — اختياري، مع نطاق ±" : "EGP per meter — optional, matched within ± range",
    searchCategory: isRTL ? "ابحث عن تصنيف..." : "Search category...",
    searchPricelist: isRTL ? "ابحث عن قائمة أسعار..." : "Search pricelist...",
    noResults: isRTL ? "لا توجد نتائج" : "No results found",
    empty: isRTL ? "لا توجد نتائج لهذه المعايير" : "No matching orders",
    loadingHint: isRTL ? "جارٍ مطابقة الطلبات مع التصنيف والسعر…" : "Matching orders to category and price…",
    access: isRTL ? "غير مصرح" : "Access denied",
    period: isRTL ? "الفترة" : "Period",
    distinctEmptyHint: isRTL
      ? "لا توجد تصنيفات متاحة حالياً لهذا الشهر. اضغط «تحديث الاقتراحات» أو غيّر الشهر/السنة لتظهر القيم."
      : "No categories available for this month right now. Press Refresh suggestions or change month/year.",
    loadListsFailed: isRTL ? "تعذر تحميل القوائم:" : "Could not load lists:",
  };

  const monthLabel = useMemo(() => {
    const ar = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
    const en = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const m = (month ?? 1) - 1;
    return `${isRTL ? ar[m] : en[m]} ${year}`;
  }, [month, year, isRTL]);

  if (currentUser && currentUser.role !== "admin" && currentUser.role !== "sales") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-muted-foreground">
        {t.access}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 font-sans antialiased">
      <PageBack locale={locale} fallbackHref="/dashboard" />

      <div className="flex flex-col gap-4 border-b border-border/60 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t.title}</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{t.subtitle}</p>
          <div className="inline-flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/40 px-3 py-1 text-xs font-medium text-foreground">
              <span className="text-muted-foreground">{t.period}</span>
              <span className="tabular-nums">{monthLabel}</span>
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-2 border-border/80 shadow-sm"
          onClick={() => void loadCategories({ showLoading: true })}
          disabled={loadingCategories}
        >
          {loadingCategories ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t.refresh}
        </Button>
      </div>

      <FilterBar
        locale={locale}
        showSalesperson={currentUser?.role === "admin"}
        showClient
        showStatus={false}
        showLevel={false}
        showProduct={false}
        multiSelectDropdowns
      />

      <Card className="overflow-hidden border-border/80 shadow-md">
        <CardHeader className="space-y-1 border-b border-border/60 bg-gradient-to-b from-muted/40 to-transparent px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" aria-hidden />
            <CardTitle className="text-base font-semibold sm:text-lg">{t.filtersCardTitle}</CardTitle>
          </div>
          <CardDescription>{t.filtersCardDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-4 sm:p-6">
          {distinctLoadError && (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="font-semibold">{t.loadListsFailed}</span>{" "}
              <span className="break-all font-mono text-xs">{distinctLoadError}</span>
            </p>
          )}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-12 lg:items-end">
            <div className="space-y-2 sm:col-span-2 lg:col-span-5">
              <label className="text-sm font-medium">{t.category}</label>
              <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-expanded={categoryOpen} className="w-full justify-between font-normal">
                    <span className="truncate">
                      {selectedCategory === CAT_PLACEHOLDER ? (isRTL ? "— اختر التصنيف —" : "— Select category —") : selectedCategory}
                    </span>
                    <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(100vw-2rem,28rem)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t.searchCategory} className="h-9" />
                    <CommandList>
                      <CommandEmpty>{t.noResults}</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__pick_category__"
                          onSelect={() => {
                            setSelectedCategory(CAT_PLACEHOLDER);
                            setCategoryOpen(false);
                          }}
                        >
                          <Check className={cn("me-2 h-4 w-4", selectedCategory === CAT_PLACEHOLDER ? "opacity-100" : "opacity-0")} />
                          {isRTL ? "— اختر التصنيف —" : "— Select category —"}
                        </CommandItem>
                        {categoryOptions.map((c) => (
                          <CommandItem
                            key={c}
                            value={c}
                            onSelect={() => {
                              setSelectedCategory(c);
                              setCategoryOpen(false);
                            }}
                          >
                            <Check className={cn("me-2 h-4 w-4", selectedCategory === c ? "opacity-100" : "opacity-0")} />
                            <span className="truncate">{c}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">{t.categoryHint}</p>
            </div>
            <div className="space-y-2 sm:col-span-2 lg:col-span-5">
              <label className="text-sm font-medium">{t.pricelist}</label>
              <Popover open={pricelistOpen} onOpenChange={setPricelistOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-expanded={pricelistOpen} className="w-full justify-between font-normal">
                    <span className="truncate">{selectedPricelist === PL_ANY ? (isRTL ? "الكل" : "All") : selectedPricelist}</span>
                    <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(100vw-2rem,28rem)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t.searchPricelist} className="h-9" />
                    <CommandList>
                      <CommandEmpty>{t.noResults}</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__any_pricelist__"
                          onSelect={() => {
                            setSelectedPricelist(PL_ANY);
                            setPricelistOpen(false);
                          }}
                        >
                          <Check className={cn("me-2 h-4 w-4", selectedPricelist === PL_ANY ? "opacity-100" : "opacity-0")} />
                          {isRTL ? "الكل" : "All"}
                        </CommandItem>
                        {pricelistOptions.map((p) => (
                          <CommandItem
                            key={p}
                            value={p}
                            onSelect={() => {
                              setSelectedPricelist(p);
                              setPricelistOpen(false);
                            }}
                          >
                            <Check className={cn("me-2 h-4 w-4", selectedPricelist === p ? "opacity-100" : "opacity-0")} />
                            <span className="truncate">{p}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">{t.pricelistHint}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="price-filter">
                  {t.price}
                </label>
                <Input
                  id="price-filter"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder={isRTL ? "اختياري" : "Optional"}
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="price-range-filter">
                  {t.priceRange}
                </label>
                <Input
                  id="price-range-filter"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder={String(DEFAULT_PRICE_RANGE)}
                  value={priceRangeInput}
                  onChange={(e) => setPriceRangeInput(e.target.value)}
                  className="h-10"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-12">{t.priceHint}</p>
          </div>
          <div className="flex justify-end border-t border-border/60 pt-4">
            <Button className="h-10 gap-2 sm:min-w-[140px]" onClick={() => void runSearch()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {t.search}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
          <p className="text-sm font-medium text-foreground">{t.loadingHint}</p>
        </div>
      ) : hasSearched && matches.length === 0 ? (
        <Card className="border-dashed border-border/80 bg-muted/10">
          <CardContent className="py-14 text-center text-muted-foreground">{t.empty}</CardContent>
        </Card>
      ) : hasSearched ? (
        <Card className="overflow-hidden border-border/80 shadow-md">
          <CardHeader className="space-y-0.5 border-b border-border/60 bg-gradient-to-b from-muted/40 to-transparent px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <Table2 className="h-5 w-5 text-primary" aria-hidden />
              <CardTitle className="text-base font-semibold">{t.resultsTitle}</CardTitle>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">
                {matches.length}
              </span>
            </div>
            <CardDescription className="text-xs sm:text-sm">{t.resultsHint}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div
              className="max-h-[min(70vh,720px)] overflow-auto overscroll-contain"
              dir={isRTL ? "rtl" : "ltr"}
            >
              <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th
                      className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start text-xs font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      {t.partner}
                    </th>
                    <th
                      className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start text-xs font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      {t.client}
                    </th>
                    <th
                      className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start text-xs font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 opacity-70" aria-hidden />
                        {t.branch}
                      </span>
                    </th>
                    <th
                      className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start text-xs font-semibold text-muted-foreground whitespace-nowrap shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      {t.dayDate}
                    </th>
                    <th
                      className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start text-xs font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      {t.invoice}
                    </th>
                    <th
                      className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start text-xs font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      {t.product}
                    </th>
                    <th
                      className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-end text-xs font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      <span className="inline-flex w-full items-center justify-end gap-1">
                        <Package className="h-3.5 w-3.5 opacity-70" aria-hidden />
                        {t.kartelaQty}
                      </span>
                    </th>
                    <th
                      className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-end text-xs font-semibold text-muted-foreground tabular-nums shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      {t.meters}
                    </th>
                    <th
                      className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-end text-xs font-semibold text-muted-foreground tabular-nums shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      {t.total}
                    </th>
                    <th
                      className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-end text-xs font-semibold text-muted-foreground tabular-nums shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      {t.unit}
                    </th>
                    <th
                      className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start text-xs font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      {t.pricelist}
                    </th>
                    <th
                      className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start text-xs font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      {t.sp}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {matches.map((r, i) => (
                    <tr key={`${r.clientId}-${r.productName}-${r.invoiceRef}-${r.lineDate}-${i}`} className="transition-colors hover:bg-muted/40">
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{r.partnerId}</td>
                      <td className="max-w-[200px] px-3 py-3 font-medium text-foreground">
                        <span className="line-clamp-2">{r.name}</span>
                      </td>
                      <td className="max-w-[130px] px-3 py-3 text-xs text-foreground" title={r.branch ?? ""}>
                        {r.branch ? <span className="line-clamp-2 break-words font-medium">{r.branch}</span> : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums text-muted-foreground">
                        {r.lineDate || "—"}
                      </td>
                      <td className="max-w-[140px] px-3 py-3 font-mono text-[11px] text-muted-foreground" title={r.invoiceRef}>
                        {r.invoiceRef ? <span className="line-clamp-2 break-all">{r.invoiceRef}</span> : "—"}
                      </td>
                      <td className="max-w-[140px] px-3 py-3 text-xs font-medium">
                        <span className="line-clamp-2">{r.productName}</span>
                      </td>
                      <td className="px-3 py-3 text-end tabular-nums">
                        {r.kartelaQty > 0 ? (
                          <span className="inline-flex min-w-[2rem] justify-end rounded-md bg-violet-500/15 px-2 py-0.5 text-sm font-semibold text-violet-900 dark:text-violet-200">
                            {r.kartelaQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-end tabular-nums text-foreground">
                        {r.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-3 text-end tabular-nums text-foreground">
                        {Math.round(r.invoiceTotal).toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-end tabular-nums font-semibold text-foreground">
                        {r.unitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="max-w-[120px] px-3 py-3 text-xs text-muted-foreground" title={r.pricelist ?? ""}>
                        {r.pricelist ? <span className="line-clamp-2">{r.pricelist}</span> : "—"}
                      </td>
                      <td className="max-w-[120px] truncate px-3 py-3 text-xs" title={r.salespersonName ?? ""}>
                        {r.salespersonName ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
              {matches.length} {isRTL ? "سطر طلب مطابق" : "matching order line(s)"}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
