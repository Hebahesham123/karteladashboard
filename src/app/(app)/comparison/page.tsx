"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PageBack } from "@/components/layout/PageBack";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";
import { formatNumber } from "@/lib/utils";
import { dataCache } from "@/lib/dataCache";

type CompareMode = "product" | "salesperson" | "client" | "kartela" | "net-profit";
type Period = { month: number; year: number };
type CompareRow = { key: string; left: number; right: number; diff: number; growth: number };

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const modeOptions: CompareMode[] = ["product", "salesperson", "client", "kartela", "net-profit"];

function growthPct(right: number, left: number): number {
  if (left === 0) return right > 0 ? 100 : 0;
  return ((right - left) / left) * 100;
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

  const years = useMemo(() => Array.from({ length: 6 }, (_, i) => currentYear - 3 + i), [currentYear]);

  const t = {
    title: isRTL ? "مقارنة شهرين" : "Month Comparison",
    subtitle: isRTL
      ? "قارن شهرين جنباً إلى جنب حسب المنتج أو المندوب أو العميل أو الكارتيلا أو صافي الربح."
      : "Compare two months side by side by product, salesperson, client, kartela, or net profit.",
    left: isRTL ? "الشهر الأول" : "Left month",
    right: isRTL ? "الشهر الثاني" : "Right month",
    mode: isRTL ? "نوع المقارنة" : "Comparison type",
    run: isRTL ? "تنفيذ المقارنة" : "Run comparison",
    loading: isRTL ? "AI analyzing comparison..." : "AI analyzing comparison...",
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
  };

  const modeLabel = (value: CompareMode) => {
    if (value === "product") return t.product;
    if (value === "salesperson") return t.salesperson;
    if (value === "client") return t.client;
    if (value === "kartela") return t.kartela;
    return t.netProfit;
  };

  const loadPeriodMap = useCallback(async (period: Period, selectedMode: CompareMode): Promise<Map<string, number>> => {
    const supabase = createClient();
    const spFilter = currentUser?.role === "sales" ? salespersonId : null;

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
  }, [currentUser?.role, isRTL, salespersonId]);

  const runComparison = useCallback(async () => {
    if (!currentUser) return;
    const cacheKey = `comparison_v1:${mode}:${left.year}-${left.month}:${right.year}-${right.month}:${currentUser.role}:${salespersonId ?? "all"}:${locale}`;
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
      const [leftMap, rightMap] = await Promise.all([loadPeriodMap(left, mode), loadPeriodMap(right, mode)]);
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
  }, [currentUser, left, right, mode, loadPeriodMap]);

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

          <Button className="gap-2" onClick={() => void runComparison()} disabled={loading}>
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
            <div className="overflow-x-auto" dir={isRTL ? "rtl" : "ltr"}>
              <table className="w-full min-w-[900px] text-sm border-collapse border border-border">
                <thead>
                  <tr className="bg-muted/70">
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
                    return (
                      <tr key={row.key} className="hover:bg-muted/30">
                        <td className="border border-border p-3">{row.key}</td>
                        <td className="border border-border p-3 text-end tabular-nums">{Math.round(row.left).toLocaleString()}</td>
                        <td className="border border-border p-3 text-end tabular-nums">{Math.round(row.right).toLocaleString()}</td>
                        <td className={`border border-border p-3 text-end tabular-nums font-semibold ${positive ? "text-green-600" : "text-red-600"}`}>
                          {positive ? "+" : ""}{Math.round(row.diff).toLocaleString()}
                        </td>
                        <td className={`border border-border p-3 text-end tabular-nums font-semibold ${positive ? "text-green-600" : "text-red-600"}`}>
                          <span className="inline-flex items-center gap-1">
                            {positive ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                            {row.growth.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
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
