"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";
import { ALLOWED_CUSTOMER_TYPES } from "@/lib/customerTypes";
import { isKartelaProductName } from "@/lib/kartelaProduct";
import { fetchDistinctCategoriesAndPricelists } from "@/lib/orderImportMeta";
import { FilterBar } from "@/components/shared/FilterBar";
import { PageBack } from "@/components/layout/PageBack";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
}

const CAT_PLACEHOLDER = "__pick_category__";
const PL_ANY = "__any_pricelist__";

function unitPriceMatchesTarget(unitPrice: number, target: number): boolean {
  const u = Math.round(unitPrice * 100) / 100;
  const t = Math.round(target * 100) / 100;
  return Math.abs(u - t) < 0.001;
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
        setCategoryOptions(fb.categories);
        setPricelistOptions(fb.pricelists);
        return;
      }
      if (json.error) setDistinctLoadError(json.error);
      setCategoryOptions(json.categories ?? []);
      setPricelistOptions(json.pricelists ?? []);
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
  }, [currentUser, filters.selectedMonth, filters.selectedYear]);

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
    if (priceTrim !== "") {
      const n = Number(priceTrim.replace(/,/g, "."));
      if (Number.isNaN(n) || n < 0) {
        setError(isRTL ? "السعر غير صالح" : "Invalid price");
        return;
      }
      targetPrice = n;
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
      const CHUNK = 100;
      for (let i = 0; i < allowedIds.length; i += CHUNK) {
        const chunk = allowedIds.slice(i, i + CHUNK);
        const q = supabase
          .from("orders")
          .select(
            "client_id, quantity, invoice_total, category, invoice_ref, pricelist, salesperson_id, products(name)"
          )
          .eq("month", month)
          .eq("year", year)
          .in("client_id", chunk);
        const { data, error: oe } = await q;
        if (oe) throw new Error(oe.message);
        orderRows.push(...(data ?? []));
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
        if (targetPrice != null && !unitPriceMatchesTarget(unitPrice, targetPrice)) continue;

        const cid = row.client_id as string;
        const c = clientMap.get(cid);
        if (!c) continue;
        const sid = row.salesperson_id as string | null;
        const lineSp = sid ? spNameById.get(sid) ?? null : null;
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
          invoiceRef: String(row.invoice_ref ?? "").trim(),
          pricelist: row.pricelist != null ? String(row.pricelist).trim() : null,
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
    pricelist: isRTL ? "قائمة الأسعار" : "Pricelist",
    pricelistHint: isRTL ? "اختياري — «الكل» لجميع قوائم الأسعار" : "Optional — “All” includes every pricelist",
    price: isRTL ? "السعر" : "Price",
    priceHint: isRTL ? "سعر المتر بالجنيه — اختياري" : "EGP per meter — optional",
    empty: isRTL ? "لا توجد نتائج لهذه المعايير" : "No matching orders",
    access: isRTL ? "غير مصرح" : "Access denied",
    period: isRTL ? "الفترة" : "Period",
    distinctEmptyHint: isRTL
      ? "لا توجد تصنيفات لهذا الشهر — تأكد أن شهر/سنة الفلتر يطابقان استيراد Excel، وأن أعمدة التصنيف وقائمة الأسعار مملوءة. على الخادم يلزم SUPABASE_SERVICE_ROLE_KEY حتى تُحمَّل القوائم كاملة."
      : "No categories for this month — match the filter month/year to your import, and ensure category & pricelist columns are filled. Set SUPABASE_SERVICE_ROLE_KEY on the server so lists load with full data.",
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
    <div className="space-y-5">
      <PageBack locale={locale} fallbackHref="/dashboard" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">{t.subtitle}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t.period}: <span className="font-semibold text-foreground">{monthLabel}</span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
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

      <Card>
        <CardContent className="pt-6 space-y-4">
          {distinctLoadError && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
              <span className="font-semibold">{t.loadListsFailed}</span>{" "}
              <span className="font-mono text-xs break-all">{distinctLoadError}</span>
            </p>
          )}
          {!distinctLoadError && !loadingCategories && categoryOptions.length === 0 && pricelistOptions.length === 0 && (
            <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              {t.distinctEmptyHint}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t.category}</label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory} dir={isRTL ? "rtl" : "ltr"}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={isRTL ? "اختر التصنيف" : "Select category"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CAT_PLACEHOLDER}>
                    {isRTL ? "— اختر التصنيف —" : "— Select category —"}
                  </SelectItem>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t.categoryHint}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t.pricelist}</label>
              <Select value={selectedPricelist} onValueChange={setSelectedPricelist} dir={isRTL ? "rtl" : "ltr"}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={isRTL ? "قائمة الأسعار" : "Pricelist"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PL_ANY}>{isRTL ? "الكل" : "All"}</SelectItem>
                  {pricelistOptions.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t.pricelistHint}</p>
            </div>
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
              />
              <p className="text-xs text-muted-foreground">{t.priceHint}</p>
            </div>
          </div>
          <Button className="gap-2" onClick={() => void runSearch()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t.search}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : hasSearched && matches.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">{t.empty}</CardContent>
        </Card>
      ) : hasSearched ? (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto" dir={isRTL ? "rtl" : "ltr"}>
              <table className="w-full min-w-[900px] text-sm border-collapse border border-border">
                <thead>
                  <tr className="bg-muted/70 dark:bg-muted/50">
                    <th className="border border-border p-3 text-start font-semibold">{t.partner}</th>
                    <th className="border border-border p-3 text-start font-semibold">{t.client}</th>
                    <th className="border border-border p-3 text-start font-semibold">{t.sp}</th>
                    <th className="border border-border p-3 text-start font-semibold">{t.product}</th>
                    <th className="border border-border p-3 text-end font-semibold tabular-nums">{t.meters}</th>
                    <th className="border border-border p-3 text-end font-semibold tabular-nums">{t.total}</th>
                    <th className="border border-border p-3 text-end font-semibold tabular-nums">{t.unit}</th>
                    <th className="border border-border p-3 text-start font-semibold">{t.pricelist}</th>
                    <th className="border border-border p-3 text-start font-semibold">{t.invoice}</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((r, i) => (
                    <tr key={`${r.clientId}-${r.productName}-${r.invoiceRef}-${i}`} className="hover:bg-muted/30">
                      <td className="border border-border p-3 font-mono text-xs text-muted-foreground">
                        {r.partnerId}
                      </td>
                      <td className="border border-border p-3 font-medium">{r.name}</td>
                      <td className="border border-border p-3 text-xs max-w-[140px] truncate" title={r.salespersonName ?? ""}>
                        {r.salespersonName ?? "—"}
                      </td>
                      <td className="border border-border p-3">{r.productName}</td>
                      <td className="border border-border p-3 text-end tabular-nums">
                        {r.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="border border-border p-3 text-end tabular-nums">
                        {Math.round(r.invoiceTotal).toLocaleString()}
                      </td>
                      <td className="border border-border p-3 text-end tabular-nums font-semibold">
                        {r.unitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="border border-border p-3 text-xs max-w-[140px] truncate" title={r.pricelist ?? ""}>
                        {r.pricelist ?? "—"}
                      </td>
                      <td className="border border-border p-3 font-mono text-xs">{r.invoiceRef || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground px-3 py-2 border-t border-border">
              {matches.length} {isRTL ? "سطر طلب" : "matching order line(s)"}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
