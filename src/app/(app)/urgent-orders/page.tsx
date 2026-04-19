"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Search, ShieldAlert, Users } from "lucide-react";
import { useStore } from "@/store/useStore";
import { PageBack } from "@/components/layout/PageBack";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Salesperson = { id: string; code: string; name: string };
type SalesLoad = { orderCount: number; meters: number };

export default function UrgentOrdersPage() {
  const { locale, currentUser } = useStore();
  const router = useRouter();
  const isRTL = locale === "ar";
  const now = new Date();
  const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => defaultYear - i);
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  const [salesLoad, setSalesLoad] = useState<Record<string, SalesLoad>>({});
  const [loading, setLoading] = useState(true);
  const [loadingLoadStats, setLoadingLoadStats] = useState(false);
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(String(defaultMonth));
  const [year, setYear] = useState(String(defaultYear));

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin") router.push("/dashboard");
  }, [currentUser, router]);

  useEffect(() => {
    let active = true;
    const loadSalespersons = async () => {
      setLoading(true);
      const supabase = createClient();
      const { data } = await supabase.from("salespersons").select("id, name, code").eq("is_active", true).order("name");
      if (!active) return;
      setSalespersons((data ?? []) as Salesperson[]);
      (data ?? []).forEach((s: Salesperson) => {
        router.prefetch(`/urgent-orders/${s.id}`);
      });
      setLoading(false);
    };
    void loadSalespersons();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    let active = true;
    const loadStats = async () => {
      setLoadingLoadStats(true);
      const supabase = createClient();
      const monthNum = Number(month);
      const yearNum = Number(year);
      const loadMap: Record<string, SalesLoad> = Object.create(null);
      // Prefer client_monthly_metrics (dashboard source; attributes clients even when
      // orders.salesperson_id is null). Fall back to salesperson_performance if the query fails.
      const pageSize = 1000;
      let from = 0;
      const cmmRows: { salesperson_id: string | null; total_meters: number | null }[] = [];
      let cmmFailed = false;
      while (active) {
        const { data: batch, error } = await supabase
          .from("client_monthly_metrics")
          .select("salesperson_id, total_meters")
          .eq("month", monthNum)
          .eq("year", yearNum)
          .not("salesperson_id", "is", null)
          .range(from, from + pageSize - 1);
        if (!active) return;
        if (error) {
          cmmFailed = true;
          break;
        }
        if (!batch?.length) break;
        cmmRows.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      if (!active) return;
      if (cmmFailed) {
        const { data: perfRows } = await supabase
          .from("salesperson_performance")
          .select("salesperson_id, active_clients, total_meters")
          .eq("month", monthNum)
          .eq("year", yearNum)
          .not("salesperson_id", "is", null);
        if (!active) return;
        (perfRows ?? []).forEach((r: { salesperson_id: string | null; active_clients: number | null; total_meters: number | null }) => {
          const sid = r.salesperson_id;
          if (!sid) return;
          loadMap[sid] = {
            orderCount: Number(r.active_clients) || 0,
            meters: Number(r.total_meters) || 0,
          };
        });
      } else {
        cmmRows.forEach((r) => {
          const sid = r.salesperson_id;
          if (!sid) return;
          if (!loadMap[sid]) loadMap[sid] = { orderCount: 0, meters: 0 };
          loadMap[sid].orderCount += 1;
          loadMap[sid].meters += Number(r.total_meters) || 0;
        });
      }
      setSalesLoad(loadMap);
      setLoadingLoadStats(false);
    };
    void loadStats();
    return () => {
      active = false;
    };
  }, [month, year]);

  const sortedSalespersons = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const base = needle
      ? salespersons.filter((s) => `${s.name} ${s.code}`.toLowerCase().includes(needle))
      : salespersons;
    return [...base].sort((a, b) => {
      const la = salesLoad[a.id] ?? { orderCount: 0, meters: 0 };
      const lb = salesLoad[b.id] ?? { orderCount: 0, meters: 0 };
      const lowA = la.orderCount === 0 || la.meters < 100;
      const lowB = lb.orderCount === 0 || lb.meters < 100;
      if (lowA !== lowB) return lowA ? -1 : 1;
      if (la.orderCount !== lb.orderCount) return la.orderCount - lb.orderCount;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }, [salespersons, salesLoad, search]);

  const stats = useMemo(() => {
    const totalSalespersons = sortedSalespersons.length;
    let lowPriorityCount = 0;
    let activeClients = 0;
    let totalMeters = 0;
    sortedSalespersons.forEach((s) => {
      const load = salesLoad[s.id] ?? { orderCount: 0, meters: 0 };
      if (load.orderCount === 0 || load.meters < 100) lowPriorityCount++;
      activeClients += load.orderCount;
      totalMeters += load.meters;
    });
    return { totalSalespersons, lowPriorityCount, activeClients, totalMeters };
  }, [sortedSalespersons, salesLoad]);

  if (currentUser?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">{isRTL ? "غير مصرح لك بالوصول" : "Access denied"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageBack locale={locale} fallbackHref="/dashboard" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{isRTL ? "الطلبات العاجلة" : "Urgent Orders"}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isRTL ? "اختر المندوب لفتح صفحة طلباته العاجلة مع الجدول والفلاتر." : "Select a salesperson to open their urgent orders table with filters."}
          </p>
        </div>
        <div className="text-xs text-muted-foreground rounded-lg border border-border px-3 py-2 bg-muted/20">
          {isRTL ? "الفترة الحالية:" : "Current period:"}{" "}
          <span className="font-semibold text-foreground">{month}/{year}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="py-3"><p className="text-xs text-muted-foreground">{isRTL ? "إجمالي المندوبين" : "Salespersons"}</p><p className="text-xl font-bold tabular-nums">{stats.totalSalespersons}</p></CardContent></Card>
        <Card><CardContent className="py-3"><p className="text-xs text-muted-foreground">{isRTL ? "أولوية عاجلة" : "Urgent priority"}</p><p className="text-xl font-bold tabular-nums text-red-500">{stats.lowPriorityCount}</p></CardContent></Card>
        <Card><CardContent className="py-3"><p className="text-xs text-muted-foreground">{isRTL ? "العملاء النشطون" : "Active clients"}</p><p className="text-xl font-bold tabular-nums">{stats.activeClients.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="py-3"><p className="text-xs text-muted-foreground">{isRTL ? "إجمالي الأمتار" : "Total meters"}</p><p className="text-xl font-bold tabular-nums">{Math.round(stats.totalMeters).toLocaleString()}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-3 md:grid-cols-3">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger>
                <SelectValue placeholder={isRTL ? "اختر الشهر" : "Select month"} />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger>
                <SelectValue placeholder={isRTL ? "اختر السنة" : "Select year"} />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="h-4 w-4 absolute top-1/2 -translate-y-1/2 left-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isRTL ? "ابحث عن مندوب..." : "Search salesperson..."}
                className="pl-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {loadingLoadStats && (
        <p className="text-xs text-muted-foreground">
          {isRTL ? "جاري تحديث ترتيب الأولوية..." : "Updating priority order..."}
        </p>
      )}
      {loading ? (
        <div className="py-10 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline me-2" />{isRTL ? "جارٍ التحميل..." : "Loading..."}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sortedSalespersons.map((s) => {
            const load = salesLoad[s.id] ?? { orderCount: 0, meters: 0 };
            const isLow = load.orderCount === 0 || load.meters < 100;
            return (
            <button
              key={s.id}
              type="button"
              onClick={() => router.push(`/urgent-orders/${s.id}`)}
              className={`group rounded-2xl border transition-all duration-200 px-4 py-3 text-start bg-card hover:shadow-lg hover:-translate-y-0.5
                ${isLow ? "border-red-300/70 dark:border-red-800/70 bg-red-50/30 dark:bg-red-950/20" : "border-border hover:border-primary/40"}
              `}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{s.code}</p>
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ${
                    isLow
                      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  }`}
                >
                  {isLow ? <AlertTriangle className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                  {isLow ? (isRTL ? "عاجل" : "Urgent") : (isRTL ? "مستقر" : "Stable")}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {isRTL ? "عملاء نشطون" : "Active clients"}
                </span>
                <span className="font-semibold tabular-nums">{load.orderCount.toLocaleString()}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {isRTL ? "الأمتار" : "Meters"}
                </span>
                <span className="font-semibold tabular-nums">{Math.round(load.meters).toLocaleString()}</span>
              </div>
            </button>
          )})}
        </div>
      )}
    </div>
  );
}
