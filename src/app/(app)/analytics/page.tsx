"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import {
  TrendingUp, TrendingDown, Award, Users, Package,
  ArrowUpRight, ArrowDownRight, ChevronRight, X,
  BarChart3, Clock, User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/shared/FilterBar";
import { PageBack } from "@/components/layout/PageBack";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";
import { formatNumber, calculateGrowthRate, isExcludedFromSalesLeaderboard } from "@/lib/utils";
import { dataCache } from "@/lib/dataCache";

const COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#f97316","#84cc16","#ec4899","#6366f1"];
const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const MONTHS_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const ANALYTICS_BOOT_PREFIX = "analytics_boot_v1:";

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-xl text-sm min-w-[130px]">
      <p className="font-semibold mb-1.5 text-foreground">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-bold">{typeof p.value === "number" ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const router = useRouter();
  const { locale, filters, setFilter, salespersonId } = useStore();
  const isRTL = locale === "ar";
  const months = isRTL ? MONTHS_AR : MONTHS_EN;

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<any[]>([]);
  const [salespersons, setSalespersons] = useState<any[]>([]);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [clientStats, setClientStats] = useState({ total: 0, active: 0, inactive: 0, retentionRate: "0", churnRate: "0" });
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState("time");

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const year          = filters.selectedYear;
    const selectedMonth = filters.selectedMonth;           // null = All Months
    const spFilter      = salespersonId || filters.selectedSalesperson;
    const cacheKey = `analytics_v1:${year ?? "all"}:${selectedMonth ?? "all"}:${spFilter ?? "all"}:${locale}`;
    const persistKey = `${ANALYTICS_BOOT_PREFIX}${cacheKey}`;

    const cached = dataCache.get<{
      products: any[];
      salespersons: any[];
      monthlyData: any[];
      clientStats: { total: number; active: number; inactive: number; retentionRate: string; churnRate: string };
    }>(cacheKey);
    if (cached) {
      setProducts(cached.products);
      setSalespersons(cached.salespersons);
      setMonthlyData(cached.monthlyData);
      setClientStats(cached.clientStats);
      setLoading(false);
      return;
    }
    if (typeof window !== "undefined") {
      try {
        const raw = window.sessionStorage.getItem(persistKey);
        if (raw) {
          const persisted = JSON.parse(raw);
          if (persisted?.products && persisted?.salespersons && persisted?.monthlyData && persisted?.clientStats) {
            setProducts(persisted.products);
            setSalespersons(persisted.salespersons);
            setMonthlyData(persisted.monthlyData);
            setClientStats(persisted.clientStats);
            setLoading(false);
          }
        }
      } catch {
        // ignore invalid persisted payload
      }
    }

    setLoading(true);

    let prodQ  = supabase.from("product_analytics").select("*").order("total_meters", { ascending: false });
    let salesQ = supabase.from("salesperson_performance").select("*").order("total_meters", { ascending: false }).limit(500);
    let trendQ = supabase.from("client_monthly_metrics").select("month, year, total_meters, client_id, level");
    let cmQ    = supabase.from("client_monthly_metrics").select("client_id, level, total_meters");

    if (year) {
      prodQ  = prodQ.eq("year",  year);
      salesQ = salesQ.eq("year", year);
      trendQ = trendQ.eq("year", year);
      cmQ    = cmQ.eq("year",    year);
    }
    if (selectedMonth) {
      prodQ  = prodQ.eq("month",  selectedMonth);
      salesQ = salesQ.eq("month", selectedMonth);
      cmQ    = cmQ.eq("month",    selectedMonth);
    }
    // Always filter salesperson_id on product_analytics: NULL = all-salespersons aggregate
    if (spFilter) {
      prodQ  = prodQ.eq("salesperson_id",  spFilter);
      salesQ = salesQ.eq("salesperson_id", spFilter);
      trendQ = trendQ.eq("salesperson_id", spFilter);
      cmQ    = cmQ.eq("salesperson_id",    spFilter);
    } else {
      prodQ = prodQ.is("salesperson_id", null);
    }

    try {
      const results = await Promise.allSettled([prodQ, salesQ, trendQ, cmQ]);
      const prod  = results[0].status === "fulfilled" ? (results[0].value as any).data : null;
      const sales = results[1].status === "fulfilled" ? (results[1].value as any).data : null;
      const trend = results[2].status === "fulfilled" ? (results[2].value as any).data : null;
      const cm    = results[3].status === "fulfilled" ? (results[3].value as any).data : null;

      // Aggregate products by name — sum meters, take max client count (not sum to avoid duplicate counting)
      const prodAgg = new Map<string, { name: string; meters: number; clients: number; orders: number }>();
      for (const p of (prod || []) as any[]) {
        const key = p.product_name as string;
        if (!key) continue;
        if (!prodAgg.has(key)) prodAgg.set(key, { name: key, meters: 0, clients: 0, orders: 0 });
        const e = prodAgg.get(key)!;
        e.meters  += Math.round(Number(p.total_meters)  || 0);
        e.clients  = Math.max(e.clients, Number(p.unique_clients) || 0);
        e.orders  += Number(p.order_count) || 0;
      }
      setProducts(Array.from(prodAgg.values()).sort((a, b) => b.meters - a.meters));

      // Aggregate salespersons by ID — sum meters, take max client/product counts
      // The view returns one row per (salesperson, month, year); without this aggregation
      // each salesperson would appear once per month in the ranking.
      const spAgg = new Map<string, { id: string; name: string; code: string; meters: number; clients: number; products: number }>();
      for (const s of (sales || []) as any[]) {
        const key = s.salesperson_id as string;
        if (!key) continue;
        if (isExcludedFromSalesLeaderboard(s.salesperson_name)) continue;
        if (!spAgg.has(key)) spAgg.set(key, { id: key, name: s.salesperson_name, code: s.salesperson_code, meters: 0, clients: 0, products: 0 });
        const e = spAgg.get(key)!;
        e.meters   += Math.round(Number(s.total_meters)  || 0);
        e.clients   = Math.max(e.clients,  Number(s.active_clients)  || 0);
        e.products  = Math.max(e.products, Number(s.unique_products) || 0);
      }
      setSalespersons(Array.from(spAgg.values()).sort((a, b) => b.meters - a.meters));

      const trendMap = new Map<string, { meters: number; clients: Set<string>; red: number; green: number; orange: number; monthIdx: number; yr: number }>();
      ((trend || []) as any[]).forEach((r: any) => {
        if (!r.month) return;
        const key = `${r.year ?? year}-${r.month}`;
        if (!trendMap.has(key)) trendMap.set(key, { meters: 0, clients: new Set(), red: 0, green: 0, orange: 0, monthIdx: r.month - 1, yr: r.year ?? year });
        const e = trendMap.get(key)!;
        e.meters += r.total_meters || 0;
        e.clients.add(r.client_id);
        if (r.level === "RED") e.red++;
        if (r.level === "GREEN") e.green++;
        if (r.level === "ORANGE") e.orange++;
      });

      const sortedKeys = Array.from(trendMap.keys()).sort();
      const trend12 = sortedKeys.length > 0
        ? sortedKeys.map((k, i) => {
            const e = trendMap.get(k)!;
            const prevKey = sortedKeys[i - 1];
            const prev = prevKey ? trendMap.get(prevKey)! : { meters: 0, clients: new Set() };
            return {
              month: `${months[e.monthIdx]}${!year ? ` ${e.yr}` : ""}`,
              meters: Math.round(e.meters),
              clients: e.clients.size,
              red: e.red,
              green: e.green,
              orange: e.orange,
              growth: i > 0 ? +calculateGrowthRate(e.meters, prev.meters).toFixed(1) : 0,
            };
          })
        : Array.from({ length: 12 }, (_, i) => ({ month: months[i], meters: 0, clients: 0, red: 0, green: 0, orange: 0, growth: 0 }));
      setMonthlyData(trend12);

      // Client stats — deduplicate by client_id
      // Sum meters per client across all months in the selected period,
      // then classify GREEN (≥100m), ORANGE (>0 <100m), RED (0m).
      const allC = (cm || []) as any[];
      const clientMeters = new Map<string, number>();
      for (const c of allC) {
        const prev = clientMeters.get(c.client_id) || 0;
        clientMeters.set(c.client_id, prev + (Number(c.total_meters) || 0));
      }
      const total  = clientMeters.size;
      let greenC   = 0;
      let orangeC  = 0;
      let redC     = 0;
      clientMeters.forEach((totalM) => {
        if      (totalM >= 100) greenC++;
        else if (totalM >  0  ) orangeC++;
        else                    redC++;
      });
      setClientStats({
        total,
        active:        greenC + orangeC,
        inactive:      redC,
        retentionRate: total > 0 ? ((greenC  / total) * 100).toFixed(1) : "0",
        churnRate:     total > 0 ? ((redC    / total) * 100).toFixed(1) : "0",
      });
      const payload = {
        products: Array.from(prodAgg.values()).sort((a, b) => b.meters - a.meters),
        salespersons: Array.from(spAgg.values()).sort((a, b) => b.meters - a.meters),
        monthlyData: trend12,
        clientStats: {
          total,
          active: greenC + orangeC,
          inactive: redC,
          retentionRate: total > 0 ? ((greenC / total) * 100).toFixed(1) : "0",
          churnRate: total > 0 ? ((redC / total) * 100).toFixed(1) : "0",
        },
      };
      dataCache.set(cacheKey, payload);
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(persistKey, JSON.stringify(payload));
        } catch {
          // ignore storage quota issues
        }
      }
    } catch (err) {
      console.error("Analytics fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [filters.selectedMonth, filters.selectedYear, filters.selectedSalesperson, salespersonId, months]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const t = {
    title: isRTL ? "التحليلات" : "Analytics",
    subtitle: isRTL ? "رؤى عميقة وتفاعلية — الأرقام دقيقة ومجمّعة لكل مندوب ومنتج" : "Deep interactive insights — numbers are accurate & aggregated per salesperson & product",
    time: isRTL ? "📅 الوقت" : "📅 Time",
    products: isRTL ? "📦 المنتجات" : "📦 Products",
    sales: isRTL ? "👥 المندوبون" : "👥 Salespeople",
    clients: isRTL ? "🏢 العملاء" : "🏢 Clients",
    clickHint: isRTL ? "انقر على أي عنصر للتفاصيل" : "Click any item for details",
    meters: isRTL ? "م" : "m",
    viewClients: isRTL ? "عرض العملاء" : "View Clients",
    best: isRTL ? "الأفضل" : "Best",
    worst: isRTL ? "الأقل" : "Lowest",
    growth: isRTL ? "نمو" : "Growth",
    decline: isRTL ? "تراجع" : "Decline",
    // Pill explanations
    retentionHelp: isRTL
      ? "% العملاء بطلبات ≥ 100م • يعني كلما ارتفع الرقم كلما كان الأداء أفضل"
      : "% clients with ≥ 100m orders • higher = better retention",
    churnHelp: isRTL
      ? "% العملاء بدون أي طلبات • يعني كلما انخفض الرقم كلما كان الأداء أفضل"
      : "% clients with zero orders • lower = better performance",
  };

  const StatPill = ({ icon: Icon, label, value, color, onClick, tooltip }: any) => (
    <div className="relative group">
      <motion.button
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={onClick}
        className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full border font-medium text-sm transition-all ${color} ${onClick ? "cursor-pointer hover:shadow-md" : "cursor-default"}`}
      >
        <Icon className="h-4 w-4" />
        <span className="text-xs text-muted-foreground">{label}:</span>
        <span className="font-bold">{value}</span>
        {onClick && <ChevronRight className="h-3.5 w-3.5 opacity-60" />}
      </motion.button>
      {tooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-popover border border-border rounded-xl shadow-xl text-xs text-foreground opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 max-w-[240px] text-center whitespace-normal">
          {tooltip}
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-9 w-48 bg-muted rounded-lg" />
        <div className="h-10 w-full bg-muted rounded-xl" />
        <div className="flex gap-3 flex-wrap">{Array(4).fill(0).map((_, i) => <div key={i} className="h-10 w-36 bg-muted rounded-full" />)}</div>
        <div className="h-12 w-80 bg-muted rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">{Array(4).fill(0).map((_, i) => <div key={i} className="h-80 bg-muted rounded-2xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageBack locale={locale} fallbackHref="/dashboard" />
      <div>
        <h1 className="text-2xl font-bold">{t.title}</h1>
        <p className="text-muted-foreground text-sm mt-0.5">{t.subtitle}</p>
      </div>

      <FilterBar locale={locale} showSalesperson showProduct />

      {/* Summary pills — all clickable with tooltips */}
      <div className="flex flex-wrap gap-2">
        <StatPill icon={Users} label={isRTL ? "إجمالي العملاء" : "Total Clients"} value={clientStats.total}
          color="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400"
          tooltip={isRTL ? "عدد العملاء الفريدين الذين لديهم طلبات في الفترة المحددة" : "Unique clients with orders in the selected period"}
          onClick={() => router.push("/clients")} />
        <StatPill icon={TrendingUp} label={isRTL ? "معدل الاحتفاظ" : "Retention Rate"} value={`${clientStats.retentionRate}%`}
          color="bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
          tooltip={t.retentionHelp}
          onClick={() => { setFilter("selectedLevel", "GREEN"); router.push("/clients"); }} />
        <StatPill icon={TrendingDown} label={isRTL ? "معدل الاستنزاف" : "Churn Rate"} value={`${clientStats.churnRate}%`}
          color="bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400"
          tooltip={t.churnHelp}
          onClick={() => { setFilter("selectedLevel", "RED"); router.push("/clients"); }} />
        {products[0] && (
          <StatPill icon={Award} label={isRTL ? "أفضل منتج" : "Best Product"} value={products[0].name}
            color="bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-400"
            tooltip={isRTL ? `${products[0].name}: ${(products[0].meters || 0).toLocaleString()} م إجمالي` : `${products[0].name}: ${(products[0].meters || 0).toLocaleString()} total meters`}
            onClick={() => setActiveTab("products")} />
        )}
        {salespersons[0] && (
          <StatPill icon={User} label={isRTL ? "أفضل مندوب" : "Top Salesperson"} value={salespersons[0].name.split(" ")[0]}
            color="bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400"
            tooltip={isRTL ? `${salespersons[0].name}: ${(salespersons[0].meters || 0).toLocaleString()} م إجمالي` : `${salespersons[0].name}: ${(salespersons[0].meters || 0).toLocaleString()} total meters`}
            onClick={() => setActiveTab("sales")} />
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto flex-wrap gap-1 p-1">
          {[
            { value: "time", icon: Clock, label: t.time },
            { value: "products", icon: Package, label: t.products },
            { value: "sales", icon: BarChart3, label: t.sales },
            { value: "clients", icon: Users, label: t.clients },
          ].map(({ value, icon: Icon, label }) => (
            <TabsTrigger key={value} value={value} className="gap-2 text-sm">
              <Icon className="h-4 w-4" />{label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── TIME ─────────────────────────────────────────────── */}
        <TabsContent value="time" className="space-y-6 mt-6">
          {/* Monthly trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isRTL ? "الاتجاه الشهري للأمتار" : "Monthly Meters Trend"}</CardTitle>
              <CardDescription>{t.clickHint}</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={monthlyData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<Tip />} />
                  <Line yAxisId="l" type="monotone" dataKey="meters" name={isRTL ? "الأمتار" : "Meters"} stroke="#3b82f6" strokeWidth={2.5} dot={{ fill: "#3b82f6", r: 5, cursor: "pointer" }} activeDot={{ r: 8, strokeWidth: 0 }} />
                  <Line yAxisId="r" type="monotone" dataKey="clients" name={isRTL ? "العملاء" : "Clients"} stroke="#10b981" strokeWidth={2.5} dot={{ fill: "#10b981", r: 5 }} activeDot={{ r: 8, strokeWidth: 0 }} strokeDasharray="5 3" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Stacked bar: healthy vs at-risk */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{isRTL ? "العملاء: جيد مقابل في خطر" : "Clients: Healthy vs At-Risk"}</CardTitle>
                <CardDescription>{isRTL ? "انقر على الأشرطة للتصفية" : "Click bars to filter"}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={monthlyData} margin={{ top: 0, right: 0, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<Tip />} />
                    <Bar dataKey="green" name={isRTL?"جيد":"Healthy"} fill="#22c55e" stackId="s" style={{ cursor: "pointer" }} onClick={() => { setFilter("selectedLevel", "GREEN"); router.push("/clients"); }} />
                    <Bar dataKey="orange" name={isRTL?"منخفض":"Low"} fill="#f97316" stackId="s" style={{ cursor: "pointer" }} onClick={() => { setFilter("selectedLevel", "ORANGE"); router.push("/clients"); }} />
                    <Bar dataKey="red" name={isRTL?"بدون طلبات":"No Orders"} fill="#ef4444" stackId="s" radius={[3,3,0,0]} style={{ cursor: "pointer" }} onClick={() => { setFilter("selectedLevel", "RED"); router.push("/clients"); }} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Growth rate table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{isRTL ? "معدل النمو الشهري" : "Monthly Growth Rate"}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto scrollbar-thin">
                  {monthlyData.map((row, i) => {
                    if (i === 0) return null;
                    const isPos = row.growth >= 0;
                    return (
                      <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-muted/30 transition-colors">
                        <span className="text-sm font-medium w-16 shrink-0">{row.month}</span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${isPos ? "bg-green-500" : "bg-red-500"}`}
                            style={{ width: `${Math.min(Math.abs(row.growth), 100)}%` }}
                          />
                        </div>
                        <div className={`flex items-center gap-1 shrink-0 text-xs font-bold ${isPos ? "text-green-600" : "text-red-600"}`}>
                          {isPos ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                          {Math.abs(row.growth)}%
                        </div>
                        <span className="text-xs text-muted-foreground w-16 text-right">{formatNumber(row.meters)}m</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Heatmap-style grid */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isRTL ? "خريطة حرارية — توزيع العملاء شهرياً" : "Heatmap — Monthly Client Distribution"}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="grid grid-cols-12 gap-1 min-w-[600px]">
                  {monthlyData.map((m, i) => {
                    const maxM = Math.max(...monthlyData.map((d) => d.meters)) || 1;
                    const intensity = m.meters / maxM;
                    return (
                      <button
                        key={i}
                        onClick={() => { setFilter("selectedMonth", i + 1); }}
                        className="group flex flex-col items-center gap-1"
                        title={`${m.month}: ${formatNumber(m.meters)}m`}
                      >
                        <div
                          className="w-full aspect-square rounded-lg transition-all hover:scale-110 hover:ring-2 hover:ring-primary"
                          style={{ backgroundColor: `rgba(59,130,246,${0.1 + intensity * 0.9})` }}
                        />
                        <span className="text-[9px] text-muted-foreground">{m.month}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground justify-end">
                  <div className="w-3 h-3 rounded bg-blue-100" />
                  <span>{isRTL ? "منخفض" : "Low"}</span>
                  <div className="w-3 h-3 rounded bg-blue-500" />
                  <span>{isRTL ? "متوسط" : "Mid"}</span>
                  <div className="w-3 h-3 rounded bg-blue-900" />
                  <span>{isRTL ? "عالي" : "High"}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PRODUCTS ─────────────────────────────────────────── */}
        <TabsContent value="products" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{isRTL ? "أفضل المنتجات (كارتيلا)" : "Top Products (Cartela)"}</CardTitle>
                <CardDescription>{isRTL ? "انقر لعرض تفاصيل المنتج" : "Click to view product details"}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={products.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={65} />
                    <Tooltip content={<Tip />} />
                    <Bar dataKey="meters" name={isRTL ? "الأمتار" : "Meters"} radius={[0, 4, 4, 0]} style={{ cursor: "pointer" }}
                      onClick={(data) => setSelectedItem({ ...data, type: "product" })}>
                      {products.slice(0, 10).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Product ranking list */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{isRTL ? "ترتيب المنتجات" : "Product Ranking"}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto scrollbar-thin">
                  {products.map((p, i) => (
                    <motion.button
                      key={p.name}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      onClick={() => setSelectedItem({ ...p, type: "product" })}
                      className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/50 transition-colors text-start group"
                    >
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-sm font-medium flex-1">{p.name}</span>
                      <Badge variant={i === 0 ? "success" : i === products.length - 1 ? "danger" : "secondary"} className="text-xs shrink-0">
                        {i === 0 ? t.best : i === products.length - 1 ? t.worst : `#${i + 1}`}
                      </Badge>
                      <span className="text-sm font-bold">{formatNumber(p.meters)}m</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </motion.button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Pie donut */}
          {products.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{isRTL ? "حصة كل منتج" : "Product Market Share"}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col lg:flex-row items-center gap-6">
                  <ResponsiveContainer width={240} height={240}>
                    <PieChart>
                      <Pie data={products.slice(0, 8)} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="meters"
                        onClick={(d) => setSelectedItem({ ...d, type: "product" })} style={{ cursor: "pointer" }}>
                        {products.slice(0, 8).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} strokeWidth={0} />)}
                      </Pie>
                      <Tooltip content={<Tip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-2 gap-2 flex-1">
                    {products.slice(0, 8).map((p, i) => {
                      const total = products.slice(0, 8).reduce((s, x) => s + x.meters, 0);
                      const pct = total > 0 ? ((p.meters / total) * 100).toFixed(1) : "0";
                      return (
                        <button key={p.name} onClick={() => setSelectedItem({ ...p, type: "product" })}
                          className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors text-start">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="text-xs font-medium truncate flex-1">{p.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{pct}%</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── SALES ────────────────────────────────────────────── */}
        <TabsContent value="sales" className="space-y-6 mt-6">
          {/* Sales tab guide */}
          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
            <BarChart3 className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {isRTL
                ? "الترتيب يعتمد على إجمالي الأمتار المباعة (بدون الكارتيلا). كل مندوب يظهر مرة واحدة فقط حتى لو باع في أشهر متعددة."
                : "Ranking is based on total meters sold (cartela rows excluded). Each salesperson appears once even if they sold across multiple months."}
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{isRTL ? "ترتيب المندوبين" : "Salesperson Ranking"}</CardTitle>
                <CardDescription>{isRTL ? "مرتب حسب إجمالي الأمتار • انقر لعرض عملاء المندوب" : "Ranked by total meters • Click to view clients"}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={salespersons.slice(0, 8)} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="code" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<Tip />} />
                    <Bar dataKey="meters" name={isRTL ? "الأمتار" : "Meters"} radius={[5, 5, 0, 0]} style={{ cursor: "pointer" }}
                      onClick={(d: any) => { setFilter("selectedSalesperson", d.id ?? null); router.push("/clients"); }}>
                      {salespersons.slice(0, 8).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{isRTL ? "قائمة المندوبين" : "Salesperson List"}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[280px] overflow-y-auto scrollbar-thin">
                  {salespersons.map((s, i) => {
                    const maxM = salespersons[0]?.meters || 1;
                    const pct = (s.meters / maxM) * 100;
                    return (
                      <motion.button
                        key={s.name}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.04 }}
                        onClick={() => { setFilter("selectedSalesperson", s.id ?? null); router.push("/clients"); }}
                        className="w-full p-2.5 rounded-xl hover:bg-muted/50 transition-colors text-start group"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{i < 3 ? ["🥇","🥈","🥉"][i] : `#${i+1}`}</span>
                            <span className="text-sm font-medium truncate max-w-[150px]">{s.name}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs shrink-0">
                            <span className="text-muted-foreground">{s.clients} {isRTL?"عميل":"cl."}</span>
                            <span className="font-bold">{formatNumber(s.meters)}m</span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                            transition={{ delay: i * 0.04 + 0.2, duration: 0.5 }}
                            className="h-full rounded-full bg-primary" />
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── CLIENTS ──────────────────────────────────────────── */}
        <TabsContent value="clients" className="space-y-6 mt-6">
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: isRTL?"إجمالي العملاء":"Total Clients", value: clientStats.total, color: "bg-blue-50 dark:bg-blue-950/20 border-blue-200", text: "text-blue-600", onClick: () => router.push("/clients") },
              { label: isRTL?"نشطون":"Active", value: clientStats.active, color: "bg-green-50 dark:bg-green-950/20 border-green-200", text: "text-green-600", onClick: () => { setFilter("selectedLevel", "GREEN"); router.push("/clients"); } },
              { label: isRTL?"بدون طلبات":"No Orders", value: clientStats.inactive, color: "bg-red-50 dark:bg-red-950/20 border-red-200", text: "text-red-600", onClick: () => { setFilter("selectedLevel", "RED"); router.push("/clients"); } },
              { label: isRTL?"معدل الاحتفاظ":"Retention", value: `${clientStats.retentionRate}%`, color: "bg-purple-50 dark:bg-purple-950/20 border-purple-200", text: "text-purple-600", onClick: () => router.push("/clients") },
            ].map((stat, i) => (
              <motion.button key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
                onClick={stat.onClick} whileHover={{ y: -3, scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className={`p-5 rounded-2xl border text-left cursor-pointer hover:shadow-md transition-all ${stat.color}`}>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className={`text-3xl font-bold mt-1 ${stat.text}`}>{stat.value}</p>
                <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  <span>{isRTL ? "انقر للتفاصيل" : "Click for details"}</span>
                </div>
              </motion.button>
            ))}
          </div>

          {/* Client distribution over months */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isRTL ? "توزيع العملاء شهرياً" : "Monthly Client Distribution"}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyData} margin={{ top: 0, right: 0, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<Tip />} />
                  <Bar dataKey="green" name={isRTL?"جيد":"Healthy"} fill="#22c55e" stackId="s" style={{ cursor: "pointer" }} onClick={() => { setFilter("selectedLevel", "GREEN"); router.push("/clients"); }} />
                  <Bar dataKey="orange" name={isRTL?"منخفض":"Low"} fill="#f97316" stackId="s" style={{ cursor: "pointer" }} onClick={() => { setFilter("selectedLevel", "ORANGE"); router.push("/clients"); }} />
                  <Bar dataKey="red" name={isRTL?"بدون طلبات":"No Orders"} fill="#ef4444" stackId="s" radius={[3,3,0,0]} style={{ cursor: "pointer" }} onClick={() => { setFilter("selectedLevel", "RED"); router.push("/clients"); }} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Drill-down Modal ───────────────────────────────────── */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelectedItem(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm"
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-xl font-bold">{selectedItem.name}</h3>
                  <p className="text-xs text-muted-foreground capitalize mt-0.5">{selectedItem.type}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedItem(null)}><X className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-3">
                {[
                  { label: isRTL ? "إجمالي الأمتار" : "Total Meters", value: `${formatNumber(selectedItem.meters || 0)}m` },
                  { label: isRTL ? "العملاء" : "Clients", value: selectedItem.clients || "—" },
                  { label: isRTL ? "الطلبات" : "Orders", value: selectedItem.orders || "—" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-muted/40">
                    <span className="text-sm text-muted-foreground">{row.label}</span>
                    <span className="text-sm font-bold">{row.value}</span>
                  </div>
                ))}
              </div>
              <Button className="w-full mt-5 gap-2" onClick={() => { setSelectedItem(null); router.push("/analytics"); }}>
                <Package className="h-4 w-4" />
                {isRTL ? "عرض التحليل الكامل" : "Full Analysis"}
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
