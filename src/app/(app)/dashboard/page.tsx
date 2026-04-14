"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Users, TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  XCircle, Activity, ChevronRight, Clock, ShoppingCart,
} from "lucide-react";
import { KPICard } from "@/components/dashboard/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Filter, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";
import {
  formatNumber,
  calculateGrowthRate,
  isExcludedFromSalesLeaderboard,
  isExcludedFromClientLeaderboard,
  cn,
} from "@/lib/utils";
import { dataCache } from "@/lib/dataCache";
import { PageBack } from "@/components/layout/PageBack";
import {
  ALLOWED_CUSTOMER_TYPES,
  allowedCustomerTypesList,
  isAllowedCustomerType,
} from "@/lib/customerTypes";

const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const MONTHS_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#f97316","#84cc16","#ec4899","#6366f1"];

/** Outside slice labels so every segment shows count + % (readable on dark/light). */
function PieSliceOutsideLabel(props: any) {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent, value } = props;
  const v = Number(value);
  if (!v || v < 1) return null;
  const ir = Number(innerRadius);
  const or = Number(outerRadius);
  const RAD = Math.PI / 180;
  const sin = Math.sin(-RAD * midAngle);
  const cos = Math.cos(-RAD * midAngle);
  const x0 = cx + (ir + (or - ir) * 0.5) * cos;
  const y0 = cy + (ir + (or - ir) * 0.5) * sin;
  const x = cx + (or + 14) * cos;
  const y = cy + (or + 14) * sin;
  const p = Math.round((Number(percent) || 0) * 100);
  const line = p > 0 ? `${v.toLocaleString()} (${p}%)` : v.toLocaleString();
  return (
    <g>
      <path d={`M${x0},${y0}L${x},${y}`} stroke="hsl(var(--muted-foreground))" fill="none" strokeWidth={1} opacity={0.85} />
      <text
        x={x}
        y={y}
        fill="hsl(var(--foreground))"
        textAnchor={cos >= 0 ? "start" : "end"}
        dominantBaseline="central"
        fontSize={10}
        fontWeight={600}
        className="tabular-nums"
      >
        {line}
      </text>
    </g>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-xl text-sm min-w-[140px]">
      <p className="font-semibold mb-2 text-foreground">{label}</p>
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

interface DrillDownData {
  type: "level" | "product" | "salesperson";
  title: string;
  items: any[];
}

const DASH_PERSIST_PREFIX = "dash_boot_v1:";

export default function DashboardPage() {
  const router = useRouter();
  const { locale, filters, setFilter, salespersonId, currentUser } = useStore();
  const isRTL = locale === "ar";

  // Sales users must not access the dashboard — send them to their own view
  useEffect(() => {
    if (currentUser?.role === "sales") router.replace("/sales");
  }, [currentUser, router]);
  const months = isRTL ? MONTHS_AR : MONTHS_EN;

  const [loading, setLoading] = useState(true);
  const [monthlyTrend, setMonthlyTrend] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRefreshHint, setShowRefreshHint] = useState(false);
  const [orderCount, setOrderCount] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [kartelaTotal, setKartelaTotal] = useState(0);
  const [kartelaClients, setKartelaClients] = useState(0);
  const [prevMeters, setPrevMeters] = useState(0);
  const [prevRevenue, setPrevRevenue] = useState(0);
  const [prevOrderCount, setPrevOrderCount] = useState(0);
  const [prevMonthlyClients, setPrevMonthlyClients] = useState(0);
  const [prevGreenLevel, setPrevGreenLevel] = useState(0);
  const [prevOrangeLevel, setPrevOrangeLevel] = useState(0);
  const [prevRedLevel, setPrevRedLevel] = useState(0);
  const [prevDormant, setPrevDormant] = useState(0);
  const [totalMetersValue, setTotalMetersValue] = useState(0);
  const [greenCount, setGreenCount] = useState(0);
  const [greenMeters, setGreenMeters] = useState(0);
  const [greenOrders, setGreenOrders] = useState(0);
  const [orangeCount, setOrangeCount] = useState(0);
  const [orangeMeters, setOrangeMeters] = useState(0);
  const [orangeOrders, setOrangeOrders] = useState(0);
  const [redCount, setRedCount] = useState(0);
  const [redOrders, setRedOrders] = useState(0);
  const [activeClientCount, setActiveClientCount] = useState(0);
  const [totalClientCount, setTotalClientCount] = useState(0);
  const [monthlyClientCount, setMonthlyClientCount] = useState(0);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [leaderboard, setLeaderboard] = useState<{ id: string; name: string; code: string; meters: number; clients: number; revenue: number }[]>([]);
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number; revenue: number; clients: number }[]>([]);
  const [topClients, setTopClients] = useState<{ client_id: string; name: string; partner_id: string; meters: number; revenue: number }[]>([]);
  // Filters (multiselect)
  const [selectedProductNames, setSelectedProductNames] = useState<string[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [selectedCustTypes, setSelectedCustTypes] = useState<string[]>([]);
  const [clientOpen, setClientOpen] = useState(false);
  const [custTypeOpen, setCustTypeOpen] = useState(false);
  const [clientPickerOptions, setClientPickerOptions] = useState<{ id: string; name: string; partner_id: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [custTypes] = useState<string[]>(() => allowedCustomerTypesList());
  const kpiCacheRef = useRef<Map<string, { totalM: number; greenC: number; orangeC: number; redC: number; activeC: number }>>(new Map());

  // ── KPI date range (main dashboard filter) ───────────────────────────────
  const now = new Date();
  // Default to the PREVIOUS month — that month's data is complete.
  // now.getMonth() is 0-indexed, so without +1 it equals the previous month (1-indexed).
  const _defMonth = now.getMonth() === 0 ? 12 : now.getMonth();          // e.g., April→March
  const _defYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const [dashFrom, setDashFrom] = useState({ month: _defMonth, year: _defYear });
  const [dashTo,   setDashTo]   = useState({ month: _defMonth, year: _defYear });
  const [spOpen,   setSpOpen]   = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  const [salespersons, setSalespersons] = useState<{ id: string; name: string }[]>([]);
  const dashYears = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);

  // Load salesperson + product lists once (customer types: VIP / تجاري / جملة)
  useEffect(() => {
    const supabase = createClient();
    supabase.from("salespersons").select("id, name").eq("is_active", true).order("name")
      .then(({ data }) => setSalespersons(data || []));
    supabase.from("products").select("id, name").eq("is_active", true).order("name")
      .then(({ data }) => setProducts((data || []).filter((p: any) =>
        !p.name.toLowerCase().includes("kartela") && !p.name.toLowerCase().includes("cartela"))));
  }, []);

  useEffect(() => {
    setSelectedCustTypes((prev) => prev.filter((t) => isAllowedCustomerType(t)));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const spFilter = salespersonId || filters.selectedSalesperson;
    let q = supabase
      .from("clients")
      .select("id, name, partner_id")
      .in("customer_type", [...ALLOWED_CUSTOMER_TYPES])
      .order("name")
      .limit(1000);
    if (spFilter) q = q.eq("salesperson_id", spFilter);
    q.then(({ data }) => setClientPickerOptions((data as { id: string; name: string; partner_id: string }[]) || []));
  }, [filters.selectedSalesperson, salespersonId]);

  // ── Rankings date range (independent from main KPI filter) ───────────────

  const [rankLoading, setRankLoading] = useState(false);

  // Always use exact total clients from table (no 1000-row cap)
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .in("customer_type", [...ALLOWED_CUSTOMER_TYPES])
      .then((res: any) => setTotalClientCount(res?.count || 0));
  }, []);

  const fetchData = useCallback(async (forceRefresh = false) => {
    const supabase  = createClient();
    const spFilter  = salespersonId || filters.selectedSalesperson;
    const startVal  = dashFrom.year * 12 + dashFrom.month;
    const endVal    = dashTo.year   * 12 + dashTo.month;
    const isSingleMonth = startVal === endVal;

    // Previous period: same length before the start of the range
    const rangeLen   = endVal - startVal + 1; // months
    const prevEndAbs = startVal - 1;
    const prevStartAbs = prevEndAbs - rangeLen + 1;
    const prevEndYear  = Math.floor(prevEndAbs / 12);
    const prevEndMonth = prevEndAbs % 12 || 12;

    const prodKey = [...selectedProductNames].sort().join("|");
    const cliKey = [...selectedClientIds].sort().join("|");
    const custKey = [...selectedCustTypes].sort().join("|");
    const cacheKey = `dash_v6:${dashFrom.year}-${dashFrom.month}:${dashTo.year}-${dashTo.month}-${spFilter || "all"}-${prodKey}-${cliKey}-${custKey}`;
    const persistKey = `${DASH_PERSIST_PREFIX}${cacheKey}`;

    // ── Global session cache hit ──────────────────────────────────────────
    const globalCached = dataCache.get<{
      totalM: number; greenC: number; orangeC: number; redC: number; activeC: number;
      monthlyC: number; prevM: number; prevR?: number; prevO?: number; prevMc?: number;
      prevLg?: number; prevLo?: number; prevLr?: number; prevDorm?: number;
      trend: any[]; totalClients: number; orderCount?: number; totalRevenue?: number; kartelaQty?: number; kartelaClients?: number;
    }>(cacheKey);
    if (globalCached && !forceRefresh) {
      setTotalMetersValue(globalCached.totalM);
      setGreenCount(globalCached.greenC);
      setOrangeCount(globalCached.orangeC);
      setRedCount(globalCached.redC);
      setActiveClientCount(globalCached.activeC);
      setMonthlyClientCount(globalCached.monthlyC || globalCached.activeC);
      setTotalClientCount(globalCached.totalClients);
      setPrevMeters(globalCached.prevM);
      setPrevRevenue(globalCached.prevR ?? 0);
      setPrevOrderCount(globalCached.prevO ?? 0);
      setPrevMonthlyClients(globalCached.prevMc ?? 0);
      setPrevGreenLevel(globalCached.prevLg ?? 0);
      setPrevOrangeLevel(globalCached.prevLo ?? 0);
      setPrevRedLevel(globalCached.prevLr ?? 0);
      setPrevDormant(globalCached.prevDorm ?? 0);
      setMonthlyTrend(globalCached.trend);
      if (globalCached.orderCount !== undefined) setOrderCount(globalCached.orderCount);
      if (globalCached.totalRevenue !== undefined) setTotalRevenue(globalCached.totalRevenue);
      setKartelaTotal(globalCached.kartelaQty ?? 0);
      setKartelaClients(globalCached.kartelaClients ?? 0);
      setLoading(false);
      setHasLoadedOnce(true);
      return;
    }

    // Fast boot after full page reload: hydrate from sessionStorage first,
    // then refresh in background so UI appears instantly.
    let hydratedFromPersist = false;
    if (!forceRefresh && typeof window !== "undefined") {
      try {
        const raw = window.sessionStorage.getItem(persistKey);
        if (raw) {
          const persisted = JSON.parse(raw) as {
            totalM: number; greenC: number; orangeC: number; redC: number; activeC: number;
            monthlyC: number; prevM: number; prevR?: number; prevO?: number; prevMc?: number;
            prevLg?: number; prevLo?: number; prevLr?: number; prevDorm?: number;
            trend: any[]; totalClients: number; orderCount?: number; totalRevenue?: number; kartelaQty?: number; kartelaClients?: number;
          };
          if (persisted && Array.isArray(persisted.trend)) {
            setTotalMetersValue(persisted.totalM ?? 0);
            setGreenCount(persisted.greenC ?? 0);
            setOrangeCount(persisted.orangeC ?? 0);
            setRedCount(persisted.redC ?? 0);
            setActiveClientCount(persisted.activeC ?? 0);
            setMonthlyClientCount(persisted.monthlyC || persisted.activeC || 0);
            setTotalClientCount(persisted.totalClients ?? 0);
            setPrevMeters(persisted.prevM ?? 0);
            setPrevRevenue(persisted.prevR ?? 0);
            setPrevOrderCount(persisted.prevO ?? 0);
            setPrevMonthlyClients(persisted.prevMc ?? 0);
            setPrevGreenLevel(persisted.prevLg ?? 0);
            setPrevOrangeLevel(persisted.prevLo ?? 0);
            setPrevRedLevel(persisted.prevLr ?? 0);
            setPrevDormant(persisted.prevDorm ?? 0);
            setMonthlyTrend(persisted.trend ?? []);
            setOrderCount(persisted.orderCount ?? 0);
            setTotalRevenue(persisted.totalRevenue ?? 0);
            setKartelaTotal(persisted.kartelaQty ?? 0);
            setKartelaClients(persisted.kartelaClients ?? 0);
            setHasLoadedOnce(true);
            setLoading(false);
            hydratedFromPersist = true;
          }
        }
      } catch {
        // Ignore storage parse errors; proceed with live fetch.
      }
    }

    if (!hasLoadedOnce && !hydratedFromPersist) setLoading(true);
    else setIsRefreshing(true);

    // Instant paint from ref cache
    const refCached = kpiCacheRef.current.get(cacheKey);
    if (refCached) {
      setTotalMetersValue(refCached.totalM);
      setGreenCount(refCached.greenC);
      setOrangeCount(refCached.orangeC);
      setRedCount(refCached.redC);
      setActiveClientCount(refCached.activeC);
    }

    try {
      const PAGE_SIZE = 1000;

      const safePages = async (table: string, cols: string, applyFilters: (q: any) => any) => {
        const all: any[] = [];
        let from = 0;
        while (true) {
          const pageQuery = applyFilters(
            supabase.from(table).select(cols)
          );
          const { data, error } = await pageQuery.range(from, from + PAGE_SIZE - 1);
          if (error) {
            // Never return a silently truncated 1000-row result.
            // Fallback once to a broad single-range read, then fail loudly.
            console.error(`[dashboard] paged fetch failed for ${table} at offset ${from}:`, error.message);
            const { data: fallback, error: fbErr } = await pageQuery.range(0, 29999);
            if (fbErr) throw new Error(`[${table}] ${fbErr.message}`);
            return fallback ?? all;
          }
          if (!data) break;
          all.push(...data);
          if (data.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
        return all;
      };

      // Aggregate per-client across all months in the range
      const summarize = (rows: any[]) => {
        const byClient = new Map<string, number>();
        rows.forEach((r: any) => {
          byClient.set(r.client_id, (byClient.get(r.client_id) || 0) + (Number(r.total_meters) || 0));
        });
        let totalM = 0, greenC = 0, orangeC = 0, activeC = 0;
        byClient.forEach((m) => {
          totalM += m;
          if (m >= 100) greenC++;
          else if (m > 0) orangeC++;
          if (m > 0) activeC++;
        });
        return { totalM, greenC, orangeC, activeC, clientCount: byClient.size };
      };

      const inRange = (m: number, y: number) => {
        const v = y * 12 + m;
        return v >= startVal && v <= endVal;
      };

      // ── 1+2. Run KPI rows, client count, order count AND trend in parallel ─
      const custTypesForFilter =
        selectedCustTypes.length > 0
          ? selectedCustTypes.filter((t) => (ALLOWED_CUSTOMER_TYPES as readonly string[]).includes(t))
          : [...ALLOWED_CUSTOMER_TYPES];

      const kpiQuery = (q: any) => {
        let qq = q.gte("year", dashFrom.year).lte("year", dashTo.year);
        if (dashFrom.year === dashTo.year) qq = qq.gte("month", dashFrom.month).lte("month", dashTo.month);
        if (spFilter) qq = qq.eq("salesperson_id", spFilter);
        qq = qq.in("customer_type", custTypesForFilter);
        if (selectedProductNames.length > 0) qq = qq.in("top_product_name", selectedProductNames);
        if (selectedClientIds.length > 0) qq = qq.in("client_id", selectedClientIds);
        return qq;
      };

      const [
        kpiRowsRaw,
        countResult,
        orderCountRes,
      ] = await Promise.all([
        // KPI rows from client_monthly_metrics
        safePages("client_monthly_metrics", "client_id, total_meters, total_revenue, order_count, cartela_count, level, month, year, customer_type", kpiQuery),
        // Total client count (head only — no rows transferred)
        (() => {
          let q = supabase.from("clients").select("id", { count: "exact", head: true }).in("customer_type", custTypesForFilter);
          if (spFilter) q = q.eq("salesperson_id", spFilter);
          if (selectedClientIds.length > 0) q = q.in("id", selectedClientIds);
          return q;
        })(),
        // Order count for the selected period (client filter only; product filter uses KPI row sum below)
        (() => {
          let q = supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .gte("year", dashFrom.year)
            .lte("year", dashTo.year);
          if (dashFrom.year === dashTo.year) q = q.gte("month", dashFrom.month).lte("month", dashTo.month);
          if (spFilter) q = q.eq("salesperson_id", spFilter);
          if (selectedClientIds.length > 0) q = q.in("client_id", selectedClientIds);
          return q;
        })(),
      ]);

      let kpiRows = kpiRowsRaw;
      const denominatorCount = (countResult as any)?.count || 0;
      setTotalClientCount(denominatorCount);
      let orderCountFinal = (orderCountRes as any)?.count || 0;

      // Client-side guard for exact boundaries (needed for cross-year ranges)
      kpiRows = kpiRows.filter((r: any) => inRange(Number(r.month), Number(r.year)));

      // ── 3. Fallback: if range empty, use latest available month ───────────
      if (kpiRows.length === 0) {
        const latestQ = await (() => {
          let q = supabase.from("client_monthly_metrics")
            .select("month, year")
            .order("year",  { ascending: false })
            .order("month", { ascending: false })
            .limit(1);
          if (spFilter) q = q.eq("salesperson_id", spFilter);
          return q;
        })();
        const latest = latestQ.data?.[0];
        if (latest?.month && latest?.year) {
          kpiRows = await safePages("client_monthly_metrics", "client_id, total_meters, total_revenue, order_count, cartela_count, level, month, year, customer_type", (q) => {
            let qq = q.eq("year", Number(latest.year)).eq("month", Number(latest.month));
            if (spFilter) qq = qq.eq("salesperson_id", spFilter);
            qq = qq.in("customer_type", custTypesForFilter);
            if (selectedProductNames.length > 0) qq = qq.in("top_product_name", selectedProductNames);
            if (selectedClientIds.length > 0) qq = qq.in("client_id", selectedClientIds);
            return qq;
          });
        }
      }

      // ── 4. Summarize — compute totals and level sub-metrics ───────────────
      const { totalM, greenC, orangeC, activeC, clientCount } = summarize(kpiRows);
      const kartelaQty = Math.round(kpiRows.reduce((s: number, r: any) => s + (Number(r.cartela_count) || 0), 0));
      const kartelaClientSet = new Set<string>();
      kpiRows.forEach((r: any) => {
        if ((Number(r.cartela_count) || 0) > 0 && r.client_id) kartelaClientSet.add(String(r.client_id));
      });
      setKartelaTotal(kartelaQty);
      setKartelaClients(kartelaClientSet.size);

      // Aggregate total revenue
      const totalRev = kpiRows.reduce((s: number, r: any) => s + (Number(r.total_revenue) || 0), 0);
      setTotalRevenue(Math.round(totalRev));

      let greenC_final = greenC;
      let orangeC_final = orangeC;
      let redC = 0;
      // Level sub-metrics: meters and orders per level
      const levelAgg = { GREEN: { meters: 0, orders: 0 }, ORANGE: { meters: 0, orders: 0 }, RED: { meters: 0, orders: 0 } };

      if (isSingleMonth) {
        const levelCount = { GREEN: 0, ORANGE: 0, RED: 0 };
        const seenSingle = new Set<string>();
        kpiRows.forEach((r: any) => {
          if (seenSingle.has(r.client_id)) return;
          seenSingle.add(r.client_id);
          const lv = r.level as "GREEN" | "ORANGE" | "RED";
          if (lv === "GREEN")       levelCount.GREEN++;
          else if (lv === "ORANGE") levelCount.ORANGE++;
          else if (lv === "RED")    levelCount.RED++;
          if (lv in levelAgg) {
            levelAgg[lv].meters += Number(r.total_meters) || 0;
            levelAgg[lv].orders += Number(r.order_count)  || 0;
          }
        });
        greenC_final  = levelCount.GREEN;
        orangeC_final = levelCount.ORANGE;
        redC          = levelCount.RED;
      } else {
        const metersByClient = new Map<string, number>();
        kpiRows.forEach((r: any) => {
          metersByClient.set(r.client_id,
            (metersByClient.get(r.client_id) || 0) + (Number(r.total_meters) || 0));
          const lv = r.level as "GREEN" | "ORANGE" | "RED";
          if (lv in levelAgg) {
            levelAgg[lv].meters += Number(r.total_meters) || 0;
            levelAgg[lv].orders += Number(r.order_count)  || 0;
          }
        });
        metersByClient.forEach((m) => { if (m === 0) redC++; });
      }

      const consistentMonthly = greenC_final + orangeC_final + redC;

      setTotalMetersValue(Math.round(totalM));
      setGreenCount(greenC_final);
      setGreenMeters(Math.round(levelAgg.GREEN.meters));
      setGreenOrders(levelAgg.GREEN.orders);
      setOrangeCount(orangeC_final);
      setOrangeMeters(Math.round(levelAgg.ORANGE.meters));
      setOrangeOrders(levelAgg.ORANGE.orders);
      setRedCount(redC);
      setRedOrders(levelAgg.RED.orders);
      setActiveClientCount(activeC);
      setMonthlyClientCount(consistentMonthly);
      kpiCacheRef.current.set(cacheKey, { totalM: Math.round(totalM), greenC: greenC_final, orangeC: orangeC_final, redC, activeC });

      // ── 5. Previous month (single-month only): same filters → compare all KPI boxes
      let prevM = 0;
      let prevR = 0;
      let prevO = 0;
      let prevMc = 0;
      let prevLg = 0;
      let prevLo = 0;
      let prevLr = 0;
      let prevDorm = 0;
      if (isSingleMonth) {
        const prevKpiRows = await safePages(
          "client_monthly_metrics",
          "client_id, total_meters, total_revenue, order_count, level, month, year, customer_type",
          (q) => {
            let qq = q.eq("month", prevEndMonth).eq("year", prevEndYear).in("customer_type", custTypesForFilter);
            if (spFilter) qq = qq.eq("salesperson_id", spFilter);
            if (selectedProductNames.length > 0) qq = qq.in("top_product_name", selectedProductNames);
            if (selectedClientIds.length > 0) qq = qq.in("client_id", selectedClientIds);
            return qq;
          },
        );
        prevM = Math.round(prevKpiRows.reduce((s: number, r: any) => s + (Number(r.total_meters) || 0), 0));
        prevR = Math.round(prevKpiRows.reduce((s: number, r: any) => s + (Number(r.total_revenue) || 0), 0));
        const seenPrev = new Set<string>();
        let g = 0, o = 0, rd = 0;
        prevKpiRows.forEach((r: any) => {
          if (seenPrev.has(r.client_id)) return;
          seenPrev.add(r.client_id);
          const lv = r.level as string;
          if (lv === "GREEN") g++;
          else if (lv === "ORANGE") o++;
          else if (lv === "RED") rd++;
        });
        prevMc = g + o + rd;
        prevLg = g;
        prevLo = o;
        prevLr = rd;
        prevDorm = Math.max(0, denominatorCount - prevMc);
        if (selectedProductNames.length > 0) {
          prevO = prevKpiRows.reduce((s: number, r: any) => s + (Number(r.order_count) || 0), 0);
        } else {
          let oq = supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("month", prevEndMonth)
            .eq("year", prevEndYear);
          if (spFilter) oq = oq.eq("salesperson_id", spFilter);
          if (selectedClientIds.length > 0) oq = oq.in("client_id", selectedClientIds);
          const { count } = await oq;
          prevO = (count as number) || 0;
        }
      }
      setPrevMeters(prevM);
      setPrevRevenue(prevR);
      setPrevOrderCount(prevO);
      setPrevMonthlyClients(prevMc);
      setPrevGreenLevel(prevLg);
      setPrevOrangeLevel(prevLo);
      setPrevRedLevel(prevLr);
      setPrevDormant(prevDorm);

      // ── 6. Monthly bar chart: same universe as KPIs (all dashboard filters) ──
      const trendAcc = new Map<string, { y: number; m: number; meters: number; revenue: number; orders: number; clients: Set<string> }>();
      kpiRows.forEach((r: any) => {
        const m = Number(r.month);
        const y = Number(r.year);
        if (!m || !y) return;
        const abs = y * 12 + m;
        if (abs < startVal || abs > endVal) return;
        const key = `${y}-${String(m).padStart(2, "0")}`;
        if (!trendAcc.has(key)) {
          trendAcc.set(key, { y, m, meters: 0, revenue: 0, orders: 0, clients: new Set() });
        }
        const e = trendAcc.get(key)!;
        e.meters += Number(r.total_meters) || 0;
        e.revenue += Number(r.total_revenue) || 0;
        e.orders += Number(r.order_count) || 0;
        if (r.client_id) e.clients.add(String(r.client_id));
      });
      const trendSorted = Array.from(trendAcc.entries()).sort(
        (a, b) => a[1].y * 12 + a[1].m - (b[1].y * 12 + b[1].m),
      );
      const trend =
        trendSorted.length > 0
          ? trendSorted.map(([, e]) => ({
              monthIdx: e.m - 1,
              year: e.y,
              meters: Math.round(e.meters),
              clients: e.clients.size,
              orders: e.orders,
              revenue: Math.round(e.revenue),
            }))
          : Array.from({ length: 12 }, (_, i) => ({
              monthIdx: i,
              year: dashTo.year,
              meters: 0,
              clients: 0,
              orders: 0,
              revenue: 0,
            }));
      setMonthlyTrend(trend);

      if (selectedProductNames.length > 0) {
        orderCountFinal = kpiRows.reduce((s: number, r: any) => s + (Number(r.order_count) || 0), 0);
      }
      setOrderCount(orderCountFinal);
      dataCache.set(cacheKey, {
        totalM: Math.round(totalM), greenC: greenC_final, orangeC: orangeC_final, redC, activeC,
        monthlyC: consistentMonthly, prevM, prevR, prevO, prevMc, prevLg, prevLo, prevLr, prevDorm, trend, totalClients: denominatorCount,
        orderCount: orderCountFinal,
        totalRevenue: Math.round(totalRev),
        kartelaQty,
        kartelaClients: kartelaClientSet.size,
      });
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(
            persistKey,
            JSON.stringify({
              totalM: Math.round(totalM), greenC: greenC_final, orangeC: orangeC_final, redC, activeC,
              monthlyC: consistentMonthly, prevM, prevR, prevO, prevMc, prevLg, prevLo, prevLr, prevDorm, trend,
              totalClients: denominatorCount, orderCount: orderCountFinal, totalRevenue: Math.round(totalRev),
              kartelaQty, kartelaClients: kartelaClientSet.size,
            })
          );
        } catch {
          // Ignore storage quota errors.
        }
      }

    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      setHasLoadedOnce(true);
    }
  }, [dashFrom, dashTo, filters.selectedSalesperson, salespersonId, hasLoadedOnce, selectedProductNames, selectedClientIds, selectedCustTypes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!isRefreshing) {
      setShowRefreshHint(false);
      return;
    }
    const t = window.setTimeout(() => setShowRefreshHint(true), 1200);
    return () => window.clearTimeout(t);
  }, [isRefreshing]);

  // ── Separate rankings fetch with its own date range ──────────────────────
  const fetchRankings = useCallback(async () => {
    const supabase = createClient();
    const spFilter = salespersonId || filters.selectedSalesperson;

    setRankLoading(true);
    try {
      const startVal = dashFrom.year * 12 + dashFrom.month;
      const endVal   = dashTo.year   * 12 + dashTo.month;
      if (startVal > endVal) { setRankLoading(false); return; }

      const inRange = (m: number, y: number) => {
        const v = y * 12 + m;
        return v >= startVal && v <= endVal;
      };

      const custTypesForFilter =
        selectedCustTypes.length > 0
          ? selectedCustTypes.filter((t) => (ALLOWED_CUSTOMER_TYPES as readonly string[]).includes(t))
          : [...ALLOWED_CUSTOMER_TYPES];

      /** Same filters as main KPI `kpiQuery` so rankings match the dashboard. */
      const rankingCmmQuery = (q: any) => {
        let qq = q.gte("year", dashFrom.year).lte("year", dashTo.year);
        if (dashFrom.year === dashTo.year) qq = qq.gte("month", dashFrom.month).lte("month", dashTo.month);
        if (spFilter) qq = qq.eq("salesperson_id", spFilter);
        qq = qq.in("customer_type", custTypesForFilter);
        if (selectedProductNames.length > 0) qq = qq.in("top_product_name", selectedProductNames);
        if (selectedClientIds.length > 0) qq = qq.in("client_id", selectedClientIds);
        return qq;
      };

      const fetchAllPages = async (buildQuery: (from: number, to: number) => any) => {
        const PAGE = 1000;
        const all: any[] = [];
        let from = 0;
        while (true) {
          const { data, error } = await buildQuery(from, from + PAGE - 1);
          if (error || !data?.length) break;
          all.push(...data);
          if (data.length < PAGE) break;
          from += PAGE;
        }
        return all;
      };

      // ── 1. Salesperson ranking (same filtered universe as KPIs via client_monthly_metrics) ──
      const spCmmRows = await fetchAllPages((from, to) =>
        rankingCmmQuery(
          supabase
            .from("client_monthly_metrics")
            .select("client_id, salesperson_id, salesperson_name, salesperson_code, total_meters, total_revenue, month, year")
            .gt("total_meters", 0)
            .range(from, to),
        ),
      );

      const spAgg = new Map<string, { name: string; code: string; meters: number; clients: number; revenue: number }>();
      const spClientSets = new Map<string, Set<string>>();
      spCmmRows.forEach((r: any) => {
        if (!inRange(Number(r.month), Number(r.year))) return;
        const sid = r.salesperson_id as string | null;
        if (!sid) return;
        if (isExcludedFromSalesLeaderboard(`${r.salesperson_name || ""} ${r.salesperson_code || ""}`.trim())) return;
        if (!spAgg.has(sid)) {
          spAgg.set(sid, {
            name: r.salesperson_name || r.salesperson_code || "—",
            code: r.salesperson_code || "",
            meters: 0,
            clients: 0,
            revenue: 0,
          });
          spClientSets.set(sid, new Set());
        }
        const e = spAgg.get(sid)!;
        e.meters += Number(r.total_meters) || 0;
        e.revenue += Number(r.total_revenue) || 0;
        spClientSets.get(sid)!.add(r.client_id as string);
      });
      spAgg.forEach((e, sid) => {
        e.clients = spClientSets.get(sid)?.size ?? 0;
      });
      setLeaderboard(
        Array.from(spAgg.entries())
          .map(([id, e]) => ({ id, ...e }))
          .sort((a, b) => b.meters - a.meters)
          .slice(0, 15),
      );

      // ── 2. Product ranking ─────────────────────────────────────────────────
      const useCmmForProducts =
        selectedCustTypes.length > 0 || selectedProductNames.length > 0 || selectedClientIds.length > 0;
      let productRanking: { name: string; qty: number; revenue: number; clients: number }[] = [];

      if (useCmmForProducts) {
        const cmmProdRows = await fetchAllPages((from, to) =>
          rankingCmmQuery(
            supabase
              .from("client_monthly_metrics")
              .select("client_id, top_product_name, total_meters, total_revenue, month, year")
              .gt("total_meters", 0)
              .range(from, to),
          ),
        );
        const prodAgg = new Map<string, { qty: number; revenue: number; clients: Set<string> }>();
        cmmProdRows.forEach((r: any) => {
          if (!inRange(Number(r.month), Number(r.year))) return;
          const name = r.top_product_name as string;
          if (!name) return;
          if (!prodAgg.has(name)) prodAgg.set(name, { qty: 0, revenue: 0, clients: new Set() });
          const p = prodAgg.get(name)!;
          p.qty += Number(r.total_meters) || 0;
          p.revenue += Number(r.total_revenue) || 0;
          p.clients.add(r.client_id as string);
        });
        productRanking = Array.from(prodAgg.entries()).map(([name, v]) => ({
          name,
          qty: v.qty,
          revenue: v.revenue,
          clients: v.clients.size,
        }));
      } else {
        const prodRows = await fetchAllPages((from, to) => {
          let q = supabase
            .from("product_analytics")
            .select("product_name, total_meters, total_revenue, unique_clients, month, year, salesperson_id")
            .gte("year", dashFrom.year)
            .lte("year", dashTo.year)
            .gt("total_meters", 0)
            .range(from, to);
          if (dashFrom.year === dashTo.year) {
            q = q.gte("month", dashFrom.month).lte("month", dashTo.month);
          }
          if (spFilter) q = q.eq("salesperson_id", spFilter);
          else q = q.is("salesperson_id", null);
          return q;
        });
        const prodAgg = new Map<string, { qty: number; revenue: number; clients: number }>();
        prodRows.forEach((r: any) => {
          if (!inRange(Number(r.month), Number(r.year))) return;
          const name = r.product_name as string;
          if (!name) return;
          const prev = prodAgg.get(name) || { qty: 0, revenue: 0, clients: 0 };
          prodAgg.set(name, {
            qty: prev.qty + (Number(r.total_meters) || 0),
            revenue: prev.revenue + (Number(r.total_revenue) || 0),
            clients: prev.clients + (Number(r.unique_clients) || 0),
          });
        });
        productRanking = Array.from(prodAgg.entries()).map(([name, v]) => ({ name, ...v }));
      }

      setTopProducts(productRanking.sort((a, b) => b.qty - a.qty).slice(0, 10));

      // ── 3. Client ranking ──────────────────────────────────────────────────
      const clientRankRows = await fetchAllPages((from, to) =>
        rankingCmmQuery(
          supabase
            .from("client_monthly_metrics")
            .select("client_id, client_name, partner_id, total_meters, total_revenue, month, year")
            .gt("total_meters", 0)
            .range(from, to),
        ),
      );

      const clientAgg = new Map<string, { name: string; partner_id: string; meters: number; revenue: number }>();
      clientRankRows.forEach((r: any) => {
        if (!inRange(Number(r.month), Number(r.year))) return;
        const key = r.client_id as string;
        if (!key) return;
        const prev = clientAgg.get(key) || { name: r.client_name || "—", partner_id: r.partner_id || "", meters: 0, revenue: 0 };
        clientAgg.set(key, {
          name:       prev.name,
          partner_id: prev.partner_id,
          meters:     prev.meters  + (Number(r.total_meters)  || 0),
          revenue:    prev.revenue + (Number(r.total_revenue) || 0),
        });
      });
      setTopClients(
        Array.from(clientAgg.entries())
          .map(([client_id, c]) => ({ client_id, ...c }))
          .filter((c) => !isExcludedFromClientLeaderboard(c.name))
          .sort((a, b) => b.meters - a.meters)
          .slice(0, 10),
      );
    } catch (e) {
      console.error("Rankings fetch error:", e);
    } finally {
      setRankLoading(false);
    }
  }, [dashFrom, dashTo, filters.selectedSalesperson, salespersonId, selectedProductNames, selectedClientIds, selectedCustTypes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchRankings(); }, [fetchRankings]);

  // ── Computed from server-side aggregates (accurate, no row-limit issues) ──
  const totalMeters    = totalMetersValue;
  const uniqueClients  = activeClientCount;
  const noOrderClients = redCount;
  const metersGrowth   = calculateGrowthRate(totalMeters, prevMeters);
  const isDashSingleMonth = dashFrom.year === dashTo.year && dashFrom.month === dashTo.month;
  const revenueGrowth = calculateGrowthRate(totalRevenue, prevRevenue);
  const clientsKpiDisplay = monthlyClientCount || uniqueClients;
  const clientsGrowth = calculateGrowthRate(clientsKpiDisplay, prevMonthlyClients);
  const ordersGrowth = calculateGrowthRate(orderCount, prevOrderCount);

  /** Product dropdown: bestsellers from rankings first, then alphabetical. */
  const productPickerList = useMemo(() => {
    const rankMap = new Map(topProducts.map((p) => [p.name, p.qty]));
    return [...products].sort((a, b) => {
      const qa = rankMap.get(a.name) ?? -1;
      const qb = rankMap.get(b.name) ?? -1;
      if (qa !== qb) return qb - qa;
      return a.name.localeCompare(b.name);
    });
  }, [products, topProducts]);

  const productFilterSummary =
    selectedProductNames.length === 0
      ? isRTL ? "كل المنتجات" : "All Products"
      : selectedProductNames.length === 1
        ? selectedProductNames[0]
        : isRTL
          ? `${selectedProductNames.length} منتجات`
          : `${selectedProductNames.length} products`;

  const clientFilterSummary =
    selectedClientIds.length === 0
      ? isRTL ? "كل العملاء" : "All Clients"
      : selectedClientIds.length === 1
        ? clientPickerOptions.find((c) => c.id === selectedClientIds[0])?.name ?? selectedClientIds[0]
        : isRTL
          ? `${selectedClientIds.length} عملاء`
          : `${selectedClientIds.length} clients`;

  const custTypeFilterSummary =
    selectedCustTypes.length === 0
      ? isRTL ? "كل الأنواع" : "All Types"
      : selectedCustTypes.length === 1
        ? selectedCustTypes[0]
        : isRTL
          ? `${selectedCustTypes.length} أنواع`
          : `${selectedCustTypes.length} types`;

  // Level counts now come directly from the RPC stats function
  const greenClients  = Array(greenCount).fill({ level: "GREEN",  client_id: "g", client_name: "" });
  const orangeClients = Array(orangeCount).fill({ level: "ORANGE", client_id: "o", client_name: "" });
  const redClients    = Array(noOrderClients).fill({ level: "RED",   client_id: "r", client_name: "" });

  // Inactive this month = clients who exist but had no March activity
  // (ordered in other months — NOT counted as "No Orders")
  const dormantThisMonth = Math.max(0, totalClientCount - monthlyClientCount);

  const pieData = [
    { name: isRTL ? "طلبات ≥ 100م"         : "Orders ≥ 100m",          value: greenClients.length,  color: "#22c55e" },
    { name: isRTL ? "طلبات 1–99م"           : "Orders 1–99m",           value: orangeClients.length, color: "#f97316" },
    { name: isRTL ? "كارتيلا فقط — بدون أمتار" : "Cartela Only – No Meters", value: redClients.length,    color: "#ef4444" },
    { name: isRTL ? "خامل (Dormant)"        : "Dormant",                value: dormantThisMonth,     color: "#94a3b8" },
  ].filter((d) => d.value > 0);

  const t = {
    title:    isRTL ? "لوحة التحكم"                          : "Dashboard",
    subtitle: isRTL ? "متابعة المبيعات والعملاء الشهرية"     : "Monthly Sales & Client Overview",

    // KPI card titles
    totalMeters:  isRTL ? "إجمالي الأمتار المباعة"           : "Total Meters Sold",
    totalClients: isRTL ? "العملاء النشطون هذا الشهر"        : "Active Clients This Month",
    healthy:      isRTL ? "طلبات أكثر من 100م"               : "Orders ≥ 100m",
    lowVolume:    isRTL ? "طلبات أقل من 100م"                : "Orders < 100m",
    noOrders:     isRTL ? "كارتيلا فقط — بدون أمتار"         : "Cartela Only – No Meters",
    inactive:     isRTL ? "خامل (Dormant)"                   : "Dormant",

    // Chart / section titles
    vsLast:       isRTL ? "مقارنةً بالشهر الماضي"            : "vs. previous month",
    compareLastMonth: isRTL ? "مقارنة بالشهر الماضي" : "Compared to last month",
    trend:        isRTL ? "اتجاه المبيعات الشهرية"            : "Monthly Sales Trend",
    distribution: isRTL ? "توزيع العملاء حسب حجم الطلبات"   : "Client Distribution by Order Volume",
    clickDetails: isRTL ? "انقر للتفاصيل"                    : "Click for details",
    viewAll:      isRTL ? "عرض جميع العملاء"                  : "View All Clients",
    clickChart:   isRTL ? "انقر على الرسم البياني للتصفية"   : "Click the chart to filter",
    meters:       isRTL ? "متر"                               : "meters",
    clients:      isRTL ? "عميل"                              : "clients",

    // KPI descriptions (tooltip on ⓘ icon)
    descMeters:
      isRTL
        ? "مجموع كميات الطلبات بالأمتار لهذا الشهر — لا يشمل طلبات الكارتيلا"
        : "Total order quantities in meters this month — cartela rows excluded",
    descClients:
      isRTL
        ? "عدد العملاء الذين لديهم طلبات (أمتار أو كارتيلا) في الشهر المحدد"
        : "Clients who placed any order (meters or cartela) in the selected month",
    descHealthy:
      isRTL
        ? "عملاء طلبوا 100 متر أو أكثر — عملاء مميزون وذوو أداء قوي"
        : "Clients who ordered 100m or more — high-value, stable buyers",
    descLowVol:
      isRTL
        ? "عملاء طلبوا بين 1 و 99 متراً — يحتاجون تحفيزاً لرفع حجم طلباتهم"
        : "Clients who ordered 1–99m — encourage them to increase volume",
    descNoOrders:
      isRTL
        ? "عملاء لديهم نشاط هذا الشهر (كارتيلا أو غيره) لكن لم يطلبوا أي أمتار — هذا الرقم مع الأخضر والبرتقالي يساوي إجمالي عملاء الشهر"
        : "Clients with activity this month but 0 meters ordered — this + green + orange equals Monthly Clients total",
    descInactive:
      isRTL
        ? "عملاء ليس لديهم أي نشاط هذا الشهر — الفرق بين إجمالي العملاء وعملاء الشهر النشطين"
        : "Clients with no activity at all this month — difference between Total Clients and Monthly Clients",
    descSalespeople:
      isRTL ? "المندوبون مرتبون حسب إجمالي الأمتار في النطاق الزمني المحدد"
            : "Salespeople ranked by total meters in the selected date range",
    descProducts:
      isRTL ? "المنتجات مرتبة حسب الكمية المباعة بالأمتار في النطاق الزمني المحدد"
            : "Products ranked by total meters sold in the selected date range",
  };

  const KpiMoMRow = ({ pct }: { pct: number }) =>
    isDashSingleMonth ? (
      <div
        className={cn(
          "mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px] md:text-[11px]",
          isRTL && "flex-row-reverse",
        )}
      >
        <span className="text-muted-foreground leading-tight">{t.compareLastMonth}</span>
        <span
          className={cn(
            "font-semibold tabular-nums leading-tight whitespace-nowrap",
            pct > 0 && "text-green-600 dark:text-green-400",
            pct < 0 && "text-red-500 dark:text-red-400",
            pct === 0 && "text-muted-foreground",
          )}
        >
          {pct > 0 ? "▲" : pct < 0 ? "▼" : "—"} {Math.abs(pct).toFixed(1)}%
        </span>
      </div>
    ) : null;

  if (loading && !hasLoadedOnce) {
    return (
      <div className="space-y-3 md:space-y-6">
        <div className="h-7 md:h-9 w-40 md:w-52 bg-muted rounded-lg animate-pulse" />
        <div className="h-8 md:h-10 w-full bg-muted rounded-xl animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
          {Array(8).fill(0).map((_, i) => <div key={i} className="h-24 md:h-32 bg-muted rounded-xl md:rounded-2xl animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-6">
          {Array(3).fill(0).map((_, i) => <div key={i} className="h-52 md:h-72 bg-muted rounded-xl md:rounded-2xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-5">
      <PageBack locale={locale} fallbackHref="/dashboard" />
      {/* Header */}
      <div className="flex items-center justify-between gap-2 md:gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg md:text-2xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-0.5 leading-snug">{t.subtitle}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { dataCache.invalidate(); fetchData(true); }} className="gap-1.5 md:gap-2 shrink-0 h-7 md:h-8 text-xs md:text-sm px-2 md:px-3">
          <Activity className="h-3.5 w-3.5" />
          {isRTL ? "تحديث" : "Refresh"}
        </Button>
      </div>

      {/* ── Unified filter bar ── */}
      <div className="rounded-lg md:rounded-xl border border-border bg-card shadow-sm px-2 py-1.5 md:px-3 md:py-2 overflow-x-auto -mx-0.5 md:mx-0">
        <div className="flex items-center gap-1.5 md:gap-2 min-w-max">
          {/* Icon label */}
          <div className="flex items-center gap-1 text-[10px] md:text-xs font-semibold text-muted-foreground shrink-0">
            <Filter className="h-3 w-3 md:h-3.5 md:w-3.5" />
            <span>{isRTL ? "تصفية" : "Filter"}</span>
          </div>

          <div className="w-px h-4 md:h-5 bg-border mx-0.5 md:mx-1" />

          {/* FROM */}
          <span className="text-[10px] md:text-xs text-muted-foreground shrink-0">{isRTL ? "من" : "From"}</span>
          <Select value={dashFrom.month.toString()} onValueChange={(v) => setDashFrom(p => ({ ...p, month: +v }))}>
            <SelectTrigger className="w-[4.5rem] md:w-28 h-7 md:h-8 text-[10px] md:text-xs px-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(isRTL ? MONTHS_AR : MONTHS_EN).map((m, i) => (
                <SelectItem key={i + 1} value={(i + 1).toString()}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={dashFrom.year.toString()} onValueChange={(v) => setDashFrom(p => ({ ...p, year: +v }))}>
            <SelectTrigger className="w-[3.25rem] md:w-20 h-7 md:h-8 text-[10px] md:text-xs px-1.5 md:px-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              {dashYears.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
            </SelectContent>
          </Select>

          <span className="text-muted-foreground text-[10px] md:text-xs shrink-0">→</span>

          {/* TO */}
          <span className="text-[10px] md:text-xs text-muted-foreground shrink-0">{isRTL ? "إلى" : "To"}</span>
          <Select value={dashTo.month.toString()} onValueChange={(v) => setDashTo(p => ({ ...p, month: +v }))}>
            <SelectTrigger className="w-[4.5rem] md:w-28 h-7 md:h-8 text-[10px] md:text-xs px-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(isRTL ? MONTHS_AR : MONTHS_EN).map((m, i) => (
                <SelectItem key={i + 1} value={(i + 1).toString()}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={dashTo.year.toString()} onValueChange={(v) => setDashTo(p => ({ ...p, year: +v }))}>
            <SelectTrigger className="w-[3.25rem] md:w-20 h-7 md:h-8 text-[10px] md:text-xs px-1.5 md:px-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              {dashYears.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="w-px h-4 md:h-5 bg-border mx-0.5 md:mx-1" />

          {/* Salesperson */}
          {salespersons.length > 0 && (
            <Popover open={spOpen} onOpenChange={setSpOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={spOpen}
                  className="w-32 md:w-44 h-7 md:h-8 text-[10px] md:text-xs justify-between font-normal shrink-0 px-2">
                  <span className="truncate">
                    {filters.selectedSalesperson
                      ? salespersons.find((s) => s.id === filters.selectedSalesperson)?.name
                      : isRTL ? "كل المندوبين" : "All Salespersons"}
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder={isRTL ? "ابحث عن مندوب..." : "Search..."} className="text-xs h-8" />
                  <CommandList>
                    <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
                      {isRTL ? "لا توجد نتائج" : "No results"}
                    </CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="all" onSelect={() => { setFilter("selectedSalesperson", null); setSpOpen(false); }} className="text-xs">
                        <Check className={`h-3.5 w-3.5 mr-2 ${!filters.selectedSalesperson ? "opacity-100" : "opacity-0"}`} />
                        {isRTL ? "كل المندوبين" : "All Salespersons"}
                      </CommandItem>
                      {salespersons.map((sp) => (
                        <CommandItem key={sp.id} value={sp.name}
                          onSelect={() => { setFilter("selectedSalesperson", filters.selectedSalesperson === sp.id ? null : sp.id); setSpOpen(false); }}
                          className="text-xs">
                          <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${filters.selectedSalesperson === sp.id ? "opacity-100" : "opacity-0"}`} />
                          <span className="truncate">{sp.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}

          <div className="w-px h-4 md:h-5 bg-border mx-0.5 md:mx-1" />

          {/* Clients — multiselect */}
          <Popover open={clientOpen} onOpenChange={setClientOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={clientOpen}
                className="w-28 md:w-40 h-7 md:h-8 text-[10px] md:text-xs justify-between font-normal shrink-0 px-2">
                <span className="truncate">{clientFilterSummary}</span>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <Command>
                <CommandInput placeholder={isRTL ? "ابحث عن عميل..." : "Search client..."} className="text-xs h-8" />
                <CommandList>
                  <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
                    {isRTL ? "لا توجد نتائج" : "No results"}
                  </CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="__all_clients__"
                      onSelect={() => { setSelectedClientIds([]); }}
                      className="text-xs"
                    >
                      <Check className={`h-3.5 w-3.5 mr-2 ${selectedClientIds.length === 0 ? "opacity-100" : "opacity-0"}`} />
                      {isRTL ? "كل العملاء" : "All Clients"}
                    </CommandItem>
                    {clientPickerOptions.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`${c.name} ${c.partner_id}`}
                        onSelect={() => {
                          setSelectedClientIds((prev) =>
                            prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                          );
                        }}
                        className="text-xs"
                      >
                        <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${selectedClientIds.includes(c.id) ? "opacity-100" : "opacity-0"}`} />
                        <span className="truncate">{c.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {/* Product filter — multiselect, sorted by bestsellers */}
          <Popover open={prodOpen} onOpenChange={setProdOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={prodOpen}
                className="w-28 md:w-40 h-7 md:h-8 text-[10px] md:text-xs justify-between font-normal shrink-0 px-2">
                <span className="truncate">{productFilterSummary}</span>
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
                    <CommandItem
                      value="__all_products__"
                      onSelect={() => { setSelectedProductNames([]); }}
                      className="text-xs"
                    >
                      <Check className={`h-3.5 w-3.5 mr-2 ${selectedProductNames.length === 0 ? "opacity-100" : "opacity-0"}`} />
                      {isRTL ? "كل المنتجات" : "All Products"}
                    </CommandItem>
                    {productPickerList.map((p) => (
                      <CommandItem
                        key={p.id}
                        value={p.name}
                        onSelect={() => {
                          setSelectedProductNames((prev) =>
                            prev.includes(p.name) ? prev.filter((n) => n !== p.name) : [...prev, p.name],
                          );
                        }}
                        className="text-xs"
                      >
                        <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${selectedProductNames.includes(p.name) ? "opacity-100" : "opacity-0"}`} />
                        <span className="truncate">{p.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {/* Customer type — multiselect */}
          <Popover open={custTypeOpen} onOpenChange={setCustTypeOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={custTypeOpen}
                className="w-[5.5rem] md:w-36 h-7 md:h-8 text-[10px] md:text-xs justify-between font-normal shrink-0 px-2">
                <span className="truncate">{custTypeFilterSummary}</span>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-0" align="start">
              <Command>
                <CommandList>
                  <CommandGroup>
                    <CommandItem
                      value="__all_types__"
                      onSelect={() => { setSelectedCustTypes([]); }}
                      className="text-xs"
                    >
                      <Check className={`h-3.5 w-3.5 mr-2 ${selectedCustTypes.length === 0 ? "opacity-100" : "opacity-0"}`} />
                      {isRTL ? "كل الأنواع" : "All Types"}
                    </CommandItem>
                    {custTypes.map((ct) => (
                      <CommandItem
                        key={ct}
                        value={ct}
                        onSelect={() => {
                          setSelectedCustTypes((prev) =>
                            prev.includes(ct) ? prev.filter((t) => t !== ct) : [...prev, ct],
                          );
                        }}
                        className="text-xs"
                      >
                        <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${selectedCustTypes.includes(ct) ? "opacity-100" : "opacity-0"}`} />
                        {ct}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {/* Active filters badge + clear */}
          {(dashFrom.year !== _defYear || dashFrom.month !== _defMonth ||
            dashTo.year  !== _defYear || dashTo.month  !== _defMonth ||
            filters.selectedSalesperson || selectedProductNames.length > 0 || selectedClientIds.length > 0 || selectedCustTypes.length > 0) && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => {
                setDashFrom({ month: _defMonth, year: _defYear });
                setDashTo({ month: _defMonth, year: _defYear });
                setFilter("selectedSalesperson", null);
                setSelectedProductNames([]);
                setSelectedClientIds([]);
                setSelectedCustTypes([]);
              }}>
              <X className="h-3.5 w-3.5" />
              {isRTL ? "مسح الكل" : "Clear"}
            </Button>
          )}
        </div>
      </div>

      {showRefreshHint && (
        <div className="text-xs text-muted-foreground">{isRTL ? "جاري تحديث الأرقام..." : "Updating numbers..."}</div>
      )}

      {/* Multi-month notice — warn user that dashboard aggregates across months
          while the clients table is always per-month */}
      {(dashFrom.year !== dashTo.year || dashFrom.month !== dashTo.month) && (
        <div className="rounded-lg md:rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-2.5 py-1.5 md:px-4 md:py-2.5 text-[10px] md:text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5 md:gap-2 leading-snug">
          <span className="shrink-0 mt-0.5">⚠️</span>
          <span>
            {isRTL
              ? "النطاق المحدد يشمل عدة أشهر — الأرقام هنا تجميع لكامل الفترة. جدول العملاء يعرض بيانات شهر واحد فقط، لذلك قد تختلف الأرقام عند الضغط على الصناديق."
              : "Multi-month range selected — these KPIs aggregate the full period. The clients table always shows one month at a time, so numbers may differ when you click through."}
          </span>
        </div>
      )}

      {/* ── 4 Main KPI Summary Cards ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 md:gap-3">
        {/* Kartela + clients + meters (first card) */}
        <button
          type="button"
          onClick={() => router.push("/kartela-analysis")}
          className="rounded-xl md:rounded-2xl border border-cyan-200 dark:border-cyan-800 bg-gradient-to-br from-cyan-50 to-cyan-100/50 dark:from-cyan-950/30 dark:to-cyan-900/10 p-2.5 md:p-4 text-start hover:shadow-md transition-all group min-w-0"
        >
          <div className="flex items-start justify-between gap-1 mb-1 md:mb-2">
            <span className="text-[10px] md:text-xs font-semibold text-cyan-600 dark:text-cyan-400 leading-tight line-clamp-2">
              {isRTL ? "الكارتيلا + العملاء + الأمتار" : "Kartela + clients + meters"}
            </span>
            <div className="h-6 w-6 md:h-8 md:w-8 rounded-lg md:rounded-xl bg-cyan-500/15 flex items-center justify-center group-hover:bg-cyan-500/25 transition-colors shrink-0">
              <CheckCircle className="h-3 w-3 md:h-4 md:w-4 text-cyan-600 dark:text-cyan-400" />
            </div>
          </div>
          <div className="space-y-0.5 text-[11px] md:text-xs text-muted-foreground">
            <div className="flex items-center justify-between"><span>{isRTL ? "كارتيلا" : "Kartela"}</span><span className="font-bold text-foreground tabular-nums">{formatNumber(kartelaTotal)}</span></div>
            <div className="flex items-center justify-between"><span>{isRTL ? "عملاء" : "Clients"}</span><span className="font-bold text-foreground tabular-nums">{formatNumber(kartelaClients)}</span></div>
            <div className="flex items-center justify-between"><span>{isRTL ? "أمتار" : "Meters"}</span><span className="font-bold text-foreground tabular-nums">{formatNumber(totalMeters)}m</span></div>
          </div>
        </button>

        {/* Revenue */}
        <button type="button" onClick={() => router.push("/clients")}
          className="rounded-xl md:rounded-2xl border border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/10 p-2.5 md:p-4 text-start hover:shadow-md transition-all group min-w-0">
          <div className="flex items-start justify-between gap-1 mb-1 md:mb-2">
            <span className="text-[10px] md:text-xs font-semibold text-amber-600 dark:text-amber-400 leading-tight line-clamp-2">{isRTL ? "الإيراد الإجمالي" : "Total Revenue"}</span>
            <div className="h-6 w-6 md:h-8 md:w-8 rounded-lg md:rounded-xl bg-amber-500/15 flex items-center justify-center group-hover:bg-amber-500/25 transition-colors shrink-0">
              <Activity className="h-3 w-3 md:h-4 md:w-4 text-amber-600 dark:text-amber-400" />
            </div>
          </div>
          <div className="text-lg md:text-2xl font-bold tabular-nums text-foreground leading-tight">{formatNumber(totalRevenue)}</div>
          <div className="text-[9px] md:text-[11px] text-muted-foreground mt-0.5">EGP</div>
          <KpiMoMRow pct={revenueGrowth} />
        </button>

        {/* Clients */}
        <button type="button" onClick={() => { dataCache.invalidate("clients_v10:"); setFilter("selectedMonth", dashTo.month); setFilter("selectedYear", dashTo.year); setFilter("selectedLevel", null); router.push("/clients"); }}
          className="rounded-xl md:rounded-2xl border border-green-200 dark:border-green-800 bg-gradient-to-br from-green-50 to-green-100/50 dark:from-green-950/30 dark:to-green-900/10 p-2.5 md:p-4 text-start hover:shadow-md transition-all group min-w-0">
          <div className="flex items-start justify-between gap-1 mb-1 md:mb-2">
            <span className="text-[10px] md:text-xs font-semibold text-green-600 dark:text-green-400 leading-tight line-clamp-2">{isRTL ? "عملاء نشطون" : "Active Clients"}</span>
            <div className="h-6 w-6 md:h-8 md:w-8 rounded-lg md:rounded-xl bg-green-500/15 flex items-center justify-center group-hover:bg-green-500/25 transition-colors shrink-0">
              <Users className="h-3 w-3 md:h-4 md:w-4 text-green-600 dark:text-green-400" />
            </div>
          </div>
          <div className="text-lg md:text-2xl font-bold tabular-nums text-foreground leading-tight">{(monthlyClientCount || uniqueClients).toLocaleString()}</div>
          <div className="text-[9px] md:text-[11px] text-muted-foreground mt-0.5 leading-tight">{isRTL ? "من" : "of"} {totalClientCount.toLocaleString()} {isRTL ? "إجمالي" : "total"}</div>
          <KpiMoMRow pct={clientsGrowth} />
        </button>

        {/* Orders */}
        <button type="button" onClick={() => router.push("/clients")}
          className="rounded-xl md:rounded-2xl border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/10 p-2.5 md:p-4 text-start hover:shadow-md transition-all group min-w-0">
          <div className="flex items-start justify-between gap-1 mb-1 md:mb-2">
            <span className="text-[10px] md:text-xs font-semibold text-purple-600 dark:text-purple-400 leading-tight line-clamp-2">{isRTL ? "عدد الطلبات" : "Orders"}</span>
            <div className="h-6 w-6 md:h-8 md:w-8 rounded-lg md:rounded-xl bg-purple-500/15 flex items-center justify-center group-hover:bg-purple-500/25 transition-colors shrink-0">
              <ShoppingCart className="h-3 w-3 md:h-4 md:w-4 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
          <div className="text-lg md:text-2xl font-bold tabular-nums text-foreground leading-tight">{formatNumber(orderCount)}</div>
          {!isDashSingleMonth && (
            <div className="text-[9px] md:text-[11px] text-muted-foreground mt-0.5 leading-tight line-clamp-2">{isRTL ? "في الفترة المحددة" : "In selected period"}</div>
          )}
          <KpiMoMRow pct={ordersGrowth} />
        </button>
      </div>

      {/* 4 KPI Cards side-by-side */}
      {(() => {
        const isSingleM = dashFrom.year === dashTo.year && dashFrom.month === dashTo.month;
        const pctLabel = isRTL
          ? (isSingleM ? "من الشهر" : "من الفترة")
          : (isSingleM ? "of month"  : "of period");
        const pct = (n: number) =>
          `${monthlyClientCount > 0 ? ((n / monthlyClientCount) * 100).toFixed(0) : 0}% ${pctLabel}`;

        const greenMom = calculateGrowthRate(greenClients.length, prevGreenLevel);
        const orangeMom = calculateGrowthRate(orangeClients.length, prevOrangeLevel);
        const redMom = calculateGrowthRate(noOrderClients, prevRedLevel);
        const dormantMom = calculateGrowthRate(dormantThisMonth, prevDormant);

        // When navigating to clients, sync the store's month/year to dashTo
        // (end of range).  For single-month selections dashFrom = dashTo so
        // this is always exact.  For multi-month ranges the last month in the
        // range is where the most recent data lives (e.g., March when the
        // range is January → March).
        const goClients = (level: string) => {
          // Clear cached clients data for the target month so the page always loads fresh
          dataCache.invalidate(`clients_v10:`);
          setFilter("selectedLevel",  level);
          setFilter("selectedMonth",  dashTo.month);
          setFilter("selectedYear",   dashTo.year);
          router.push("/clients");
        };

        const SubMetric = ({ label, val, textCls }: { label: string; val: string | number; textCls?: string }) => (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground/70 text-[11px]">{label}</span>
            <span className={`font-bold tabular-nums text-[13px] ${textCls ?? ""}`}>
              {typeof val === "number" ? val.toLocaleString() : val}
            </span>
          </div>
        );

        const LevelBox = ({
          onClick, borderCls, bgCls, iconBgCls, textCls, subTextCls, dividerCls,
          icon, title, clients, clientsPct, orders, meters, momPct,
        }: {
          onClick: () => void; borderCls: string; bgCls: string; iconBgCls: string;
          textCls: string; subTextCls: string; dividerCls: string;
          icon: React.ReactNode; title: string;
          clients: number; clientsPct: string; orders: number; meters: string;
          momPct: number;
        }) => (
          <div onClick={onClick} className={`cursor-pointer rounded-2xl border ${borderCls} ${bgCls} p-4 hover:shadow-md transition-shadow`}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`rounded-lg ${iconBgCls} p-1.5`}>{icon}</div>
              <span className={`text-xs font-semibold ${textCls}`}>{title}</span>
            </div>
            <div className={`border-t ${dividerCls} pt-2 mt-1 space-y-1`}>
              <SubMetric label={isRTL ? "عملاء" : "Clients"} val={clients} textCls={textCls} />
              <SubMetric label={isRTL ? "طلبات" : "Orders"} val={orders} textCls={textCls} />
              <SubMetric label={isRTL ? "أمتار"  : "Meters"} val={meters} textCls={textCls} />
            </div>
            <p className={`text-[10px] mt-1.5 ${subTextCls}`}>{clientsPct}</p>
            <KpiMoMRow pct={momPct} />
          </div>
        );

        return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <LevelBox
          onClick={() => goClients("GREEN")}
          borderCls="border-green-200 dark:border-green-800"
          bgCls="bg-green-50 dark:bg-green-950/20"
          iconBgCls="bg-green-500/20"
          textCls="text-green-700 dark:text-green-300"
          subTextCls="text-green-600/70"
          dividerCls="border-green-200 dark:border-green-800"
          icon={<CheckCircle className="h-4 w-4 text-green-600" />}
          title={t.healthy}
          clients={greenClients.length}
          clientsPct={`${pct(greenClients.length)}`}
          orders={greenOrders}
          meters={`${formatNumber(greenMeters)}m`}
          momPct={greenMom}
        />
        <LevelBox
          onClick={() => goClients("ORANGE")}
          borderCls="border-orange-200 dark:border-orange-800"
          bgCls="bg-orange-50 dark:bg-orange-950/20"
          iconBgCls="bg-orange-500/20"
          textCls="text-orange-700 dark:text-orange-300"
          subTextCls="text-orange-600/70"
          dividerCls="border-orange-200 dark:border-orange-800"
          icon={<AlertTriangle className="h-4 w-4 text-orange-600" />}
          title={t.lowVolume}
          clients={orangeClients.length}
          clientsPct={`${pct(orangeClients.length)}`}
          orders={orangeOrders}
          meters={`${formatNumber(orangeMeters)}m`}
          momPct={orangeMom}
        />
        <LevelBox
          onClick={() => goClients("RED")}
          borderCls="border-red-200 dark:border-red-800"
          bgCls="bg-red-50 dark:bg-red-950/20"
          iconBgCls="bg-red-500/20"
          textCls="text-red-700 dark:text-red-300"
          subTextCls="text-red-600/70"
          dividerCls="border-red-200 dark:border-red-800"
          icon={<XCircle className="h-4 w-4 text-red-600" />}
          title={t.noOrders}
          clients={noOrderClients}
          clientsPct={`${pct(noOrderClients)}`}
          orders={redOrders}
          meters="0m"
          momPct={redMom}
        />
        <LevelBox
          onClick={() => goClients("INACTIVE")}
          borderCls="border-slate-200 dark:border-slate-700"
          bgCls="bg-slate-50 dark:bg-slate-900/20"
          iconBgCls="bg-slate-500/20"
          textCls="text-slate-700 dark:text-slate-300"
          subTextCls="text-slate-600/70"
          dividerCls="border-slate-200 dark:border-slate-700"
          icon={<Clock className="h-4 w-4 text-slate-600" />}
          title={t.inactive}
          clients={dormantThisMonth}
          clientsPct={`${totalClientCount > 0 ? ((dormantThisMonth / totalClientCount) * 100).toFixed(0) : 0}% ${isRTL ? "من الكل" : "of total"}`}
          orders={0}
          meters="0m"
          momPct={dormantMom}
        />
      </div>
        );
      })()}

      {/* Distribution chart */}
      <div className="grid grid-cols-1 gap-3 md:gap-6">
        <Card>
          <CardHeader className="pb-1.5 md:pb-2 px-3 md:px-6 pt-3 md:pt-6">
            <CardTitle className="text-sm md:text-base">{t.distribution}</CardTitle>
            <p className="text-[10px] md:text-xs text-muted-foreground leading-snug">
              {isRTL
                ? "🟢 جيد ≥100م  •  🟠 منخفض 1–99م  •  🔴 بدون أمتار  •  ⚫ غير نشط هذا الشهر"
                : "🟢 Healthy ≥100m  •  🟠 Low 1–99m  •  🔴 0m (cartela only)  •  ⚫ Inactive this month"}
            </p>
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <div className="h-[160px] md:h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <Pie
                  data={pieData}
                  cx="50%" cy="50%"
                  innerRadius={44}
                  outerRadius={72}
                  dataKey="value"
                  labelLine={false}
                  label={PieSliceOutsideLabel}
                  onClick={(data: any) => {
                    const levelMap: Record<string, string> = {
                      [isRTL ? "طلبات ≥ 100م"              : "Orders ≥ 100m"]:           "GREEN",
                      [isRTL ? "طلبات 1–99م"                : "Orders 1–99m"]:            "ORANGE",
                      [isRTL ? "كارتيلا فقط — بدون أمتار"  : "Cartela Only – No Meters"]: "RED",
                      [isRTL ? "خامل (Dormant)"             : "Dormant"]:                  "INACTIVE",
                    };
                    const level = levelMap[data?.name as string];
                    if (level) { setFilter("selectedLevel", level); router.push("/clients"); }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} strokeWidth={0} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="space-y-1 md:space-y-2 mt-1.5 md:mt-2">
              {pieData.map((d) => (
                <button
                  key={d.name}
                  onClick={() => {
                    const levelMap: Record<string, string> = {
                      [isRTL ? "طلبات ≥ 100م"              : "Orders ≥ 100m"]:           "GREEN",
                      [isRTL ? "طلبات 1–99م"                : "Orders 1–99m"]:            "ORANGE",
                      [isRTL ? "كارتيلا فقط — بدون أمتار"  : "Cartela Only – No Meters"]: "RED",
                      [isRTL ? "خامل (Dormant)"             : "Dormant"]:                  "INACTIVE",
                    };
                    const level = levelMap[d.name];
                    if (level) { setFilter("selectedLevel", level); router.push("/clients"); }
                  }}
                  className="flex items-center justify-between w-full px-1.5 py-1 md:px-2 md:py-1.5 rounded-lg hover:bg-muted/50 transition-colors text-xs md:text-sm group gap-1"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span>{d.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{d.value.toLocaleString()}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rankings — 3 columns */}
      <div>
        <div className="flex items-center justify-between mb-2 md:mb-3 gap-2">
          <div className="flex items-center gap-1.5 md:gap-2 min-w-0 flex-wrap">
            <span className="text-sm md:text-base font-bold text-foreground">{isRTL ? "الترتيب" : "Rankings"}</span>
            <span className="text-[10px] md:text-xs px-2 py-0.5 md:px-2.5 md:py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold leading-tight">
              {(isRTL ? MONTHS_AR : MONTHS_EN)[dashFrom.month - 1]} {dashFrom.year}
              {(dashFrom.month !== dashTo.month || dashFrom.year !== dashTo.year) && ` → ${(isRTL ? MONTHS_AR : MONTHS_EN)[dashTo.month - 1]} ${dashTo.year}`}
            </span>
          </div>
          {rankLoading && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              {isRTL ? "جاري التحديث..." : "Updating..."}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 md:gap-4">

        {/* Salesperson Leaderboard */}
        <Card>
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardTitle className="text-sm md:text-base flex items-center gap-1.5 md:gap-2">
              <span>🏆</span>
              {isRTL ? "ترتيب المندوبين" : "Salesperson Ranking"}
            </CardTitle>
            <p className="text-[10px] md:text-xs text-muted-foreground">
              {isRTL ? "مرتب حسب إجمالي الأمتار" : "Sorted by total meters"}
            </p>
          </CardHeader>
          <CardContent className="px-2 pb-2 md:px-3 md:pb-3">
            {leaderboard.length === 0 ? (
              <p className="text-xs md:text-sm text-muted-foreground text-center py-4 md:py-8">
                {isRTL ? "لا توجد بيانات" : "No data"}
              </p>
            ) : (
              <div className="space-y-1">
                {leaderboard.map((sp, i) => {
                  const maxM = leaderboard[0]?.meters || 1;
                  const pct  = Math.round((sp.meters / maxM) * 100);
                  const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                  const isSel = filters.selectedSalesperson === sp.id;
                  return (
                    <button
                      type="button"
                      key={sp.id}
                      onClick={() => setFilter("selectedSalesperson", isSel ? null : sp.id)}
                      className={cn(
                        "w-full flex items-center gap-2 md:gap-3 px-1 md:px-2 py-1 md:py-1.5 rounded-lg text-start transition-colors",
                        "hover:bg-muted/40",
                        isSel && "ring-1 ring-primary/50 bg-primary/5",
                      )}
                    >
                      <span className="w-5 md:w-6 text-center text-xs md:text-sm font-bold text-muted-foreground shrink-0">
                        {medal ?? `${i + 1}`}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5 gap-1">
                          <span className="text-xs md:text-sm font-medium truncate">{sp.name}</span>
                          <div className="text-end shrink-0 ms-1 md:ms-2">
                            <div className="text-xs md:text-sm font-bold tabular-nums">{formatNumber(Math.round(sp.meters))}m</div>
                            {sp.revenue > 0 && <div className="text-[9px] md:text-[10px] text-muted-foreground">{formatNumber(Math.round(sp.revenue))} EGP</div>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 md:gap-2">
                          <div className="flex-1 h-1 md:h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : i === 2 ? "#cd7f32" : "#3b82f6",
                              }}
                            />
                          </div>
                          <span className="text-[10px] md:text-xs text-muted-foreground shrink-0">
                            {sp.clients} {isRTL ? "عميل" : "clients"}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Product Ranking */}
        <Card>
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardTitle className="text-sm md:text-base flex items-center gap-1.5 md:gap-2">
              <span>📦</span>
              {isRTL ? "ترتيب المنتجات" : "Product Ranking"}
            </CardTitle>
            <p className="text-[10px] md:text-xs text-muted-foreground">
              {isRTL ? "مرتب حسب الكمية المباعة (بالأمتار)" : "Sorted by quantity sold (meters)"}
            </p>
          </CardHeader>
          <CardContent className="px-2 pb-2 md:px-3 md:pb-3">
            {topProducts.length === 0 ? (
              <p className="text-xs md:text-sm text-muted-foreground text-center py-4 md:py-8">
                {isRTL ? "لا توجد بيانات" : "No data"}
              </p>
            ) : (
              <div className="space-y-1">
                {topProducts.map((p, i) => {
                  const maxQ = topProducts[0]?.qty || 1;
                  const pct  = Math.round((p.qty / maxQ) * 100);
                  const colors = ["#6366f1","#3b82f6","#06b6d4","#10b981","#f59e0b","#f97316","#ef4444","#ec4899","#8b5cf6","#84cc16"];
                  const isSel = selectedProductNames.includes(p.name);
                  return (
                    <button
                      type="button"
                      key={p.name}
                      onClick={() =>
                        setSelectedProductNames((prev) =>
                          prev.includes(p.name) ? prev.filter((n) => n !== p.name) : [...prev, p.name],
                        )
                      }
                      className={cn(
                        "w-full flex items-center gap-2 md:gap-3 px-1 md:px-2 py-1 md:py-1.5 rounded-lg text-start transition-colors",
                        "hover:bg-muted/40",
                        isSel && "ring-1 ring-primary/50 bg-primary/5",
                      )}
                    >
                      <span className="w-5 md:w-6 text-center text-xs md:text-sm font-bold text-muted-foreground shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5 gap-1">
                          <span className="text-xs md:text-sm font-medium truncate">{p.name}</span>
                          <div className="text-end shrink-0 ms-1 md:ms-2">
                            <div className="text-xs md:text-sm font-bold tabular-nums">{formatNumber(Math.round(p.qty))}m</div>
                            {p.revenue > 0 && <div className="text-[9px] md:text-[10px] text-muted-foreground">{formatNumber(Math.round(p.revenue))} EGP</div>}
                          </div>
                        </div>
                        <div className="h-1 md:h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: colors[i % colors.length] }} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Client Ranking */}
        <Card>
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardTitle className="text-sm md:text-base flex items-center gap-1.5 md:gap-2">
              <span>👤</span>
              {isRTL ? "ترتيب العملاء" : "Client Ranking"}
            </CardTitle>
            <p className="text-[10px] md:text-xs text-muted-foreground">
              {isRTL ? "مرتب حسب الأمتار المشتراة" : "Sorted by meters purchased"}
            </p>
          </CardHeader>
          <CardContent className="px-2 pb-2 md:px-3 md:pb-3">
            {topClients.length === 0 ? (
              <p className="text-xs md:text-sm text-muted-foreground text-center py-4 md:py-8">{isRTL ? "لا توجد بيانات" : "No data"}</p>
            ) : (
              <div className="space-y-1">
                {topClients.map((c, i) => {
                  const maxM = topClients[0]?.meters || 1;
                  const pct  = Math.round((c.meters / maxM) * 100);
                  const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                  const isSel = selectedClientIds.includes(c.client_id);
                  return (
                    <button
                      type="button"
                      key={c.client_id}
                      onClick={() =>
                        setSelectedClientIds((prev) =>
                          prev.includes(c.client_id) ? prev.filter((x) => x !== c.client_id) : [...prev, c.client_id],
                        )
                      }
                      className={cn(
                        "w-full flex items-center gap-2 md:gap-3 px-1 md:px-2 py-1 md:py-1.5 rounded-lg text-start transition-colors",
                        "hover:bg-muted/40",
                        isSel && "ring-1 ring-primary/50 bg-primary/5",
                      )}
                    >
                      <span className="w-5 md:w-6 text-center text-xs md:text-sm font-bold text-muted-foreground shrink-0">{medal ?? `${i + 1}`}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5 gap-1">
                          <div className="min-w-0">
                            <span className="text-xs md:text-sm font-medium truncate block">{c.name}</span>
                            <span className="text-[9px] md:text-[10px] text-muted-foreground font-mono">{c.partner_id}</span>
                          </div>
                          <div className="text-end shrink-0 ms-1 md:ms-2">
                            <div className="text-xs md:text-sm font-bold tabular-nums">{formatNumber(Math.round(c.meters))}m</div>
                            {c.revenue > 0 && <div className="text-[9px] md:text-[10px] text-muted-foreground">{formatNumber(Math.round(c.revenue))} EGP</div>}
                          </div>
                        </div>
                        <div className="space-y-0.5">
                          <div className="h-1 md:h-1.5 bg-muted rounded-full overflow-hidden relative">
                            <div className="h-full rounded-full transition-all duration-500 bg-violet-500" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex justify-between items-center gap-1 text-[10px] md:text-xs tabular-nums">
                            <span className="text-muted-foreground">{isRTL ? "أمتار" : "Meters"}</span>
                            <span className="font-bold text-foreground">{Math.round(c.meters).toLocaleString()} m</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>


        </div>{/* end rankings grid */}
      </div>{/* end rankings wrapper */}

    </div>
  );
}
