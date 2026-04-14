"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { useStore } from "@/store/useStore";
import { PageBack } from "@/components/layout/PageBack";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";

type Salesperson = { id: string; code: string; name: string };
type SalesLoad = { orderCount: number; meters: number };

export default function UrgentOrdersPage() {
  const { locale, currentUser } = useStore();
  const router = useRouter();
  const isRTL = locale === "ar";
  const now = new Date();
  const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
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
    const loadSalespersons = async () => {
      const supabase = createClient();
      const { data } = await supabase.from("salespersons").select("id, name, code").eq("is_active", true).order("name");
      setSalespersons((data ?? []) as Salesperson[]);
      (data ?? []).forEach((s: Salesperson) => {
        router.prefetch(`/urgent-orders/${s.id}`);
      });
      setLoading(false);
      setLoadingLoadStats(true);

      const monthNum = Number(month);
      const yearNum = Number(year);
      const loadMap: Record<string, SalesLoad> = Object.create(null);
      const { data: perfRows, error } = await supabase
          .from("salesperson_performance")
          .select("salesperson_id, active_clients, total_meters")
          .eq("month", monthNum)
          .eq("year", yearNum)
          .not("salesperson_id", "is", null);
      if (!error && perfRows?.length) {
        perfRows.forEach((r: { salesperson_id: string | null; active_clients: number | null; total_meters: number | null }) => {
          const sid = r.salesperson_id;
          if (!sid) return;
          loadMap[sid] = {
            // We use active clients as a fast load indicator for urgency ranking.
            orderCount: Number(r.active_clients) || 0,
            meters: Number(r.total_meters) || 0,
          };
        });
      }
      setSalesLoad(loadMap);
      setLoadingLoadStats(false);
    };
    void loadSalespersons();
  }, [month, year, router]);

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
      <div>
        <h1 className="text-2xl font-bold">{isRTL ? "الطلبات العاجلة" : "Urgent Orders"}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {isRTL ? "اختر صندوق المندوب لفتح صفحة طلباته (جدول + فلاتر)" : "Click a salesperson box to open their orders page (table + filters)"}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Input value={month} onChange={(e) => setMonth(e.target.value)} placeholder={isRTL ? "شهر" : "Month"} />
        <Input value={year} onChange={(e) => setYear(e.target.value)} placeholder={isRTL ? "سنة" : "Year"} />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isRTL ? "ابحث عن مندوب..." : "Search salesperson..."} />
      </div>
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
              className={`rounded-lg border transition px-3 py-3 text-start bg-gradient-to-br from-slate-900/30 via-slate-800/20 to-slate-700/10
                ${isLow ? "border-red-400/50 shadow-[0_0_0_1px_rgba(248,113,113,0.2)]" : "border-border/70"}
                hover:from-slate-900/40 hover:via-slate-800/25 hover:to-slate-700/15`}
            >
              <p className="text-sm font-semibold truncate">{s.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{s.code}</p>
              <p className={`mt-1 text-[11px] ${isLow ? "text-red-300" : "text-muted-foreground"}`}>
                {isRTL ? `عملاء نشطون: ${load.orderCount} · أمتار: ${Math.round(load.meters)}` : `Active Clients: ${load.orderCount} · Meters: ${Math.round(load.meters)}`}
              </p>
            </button>
          )})}
        </div>
      )}
    </div>
  );
}
