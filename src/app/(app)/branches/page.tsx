"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  Table2,
  X,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { PageBack } from "@/components/layout/PageBack";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatNumber, cn } from "@/lib/utils";
import { isKartelaProductName, kartelaFamilyBaseKey } from "@/lib/kartelaProduct";

type BranchSummary = { branch: string | null; order_count: number; total_revenue: number };

type OrderRow = {
  id: string;
  client_id: string;
  month: number;
  year: number;
  quantity: number;
  invoice_total: number;
  invoice_ref: string;
  branch: string | null;
  invoice_date: string | null;
  category: string | null;
  pricelist: string | null;
  created_at: string;
  client_name: string;
  partner_id: string;
  product_name: string;
  salesperson_code: string | null;
  salesperson_name: string | null;
  meter_breakdown?: unknown;
};

function parseMeterBreakdown(raw: unknown): unknown[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? p : null;
    } catch {
      return null;
    }
  }
  return null;
}

function kartelaQtyFromMeterBreakdown(raw: unknown): number {
  const arr = parseMeterBreakdown(raw);
  if (!arr) return 0;
  let sum = 0;
  for (const x of arr) {
    const label = String((x as { label?: string; name?: string })?.label ?? (x as { name?: string }).name ?? "").trim();
    const v = Number((x as { meters?: number }).meters) || 0;
    if (v <= 0 || !label) continue;
    if (
      /كارت|كارتيلا|kartela|cartela/i.test(label) ||
      (/color\s*:/i.test(label) && /كارت/i.test(label)) ||
      /كرتون|carton/i.test(label)
    ) {
      sum += v;
    }
  }
  return sum;
}

/** Sum explicit كارتيلا product lines per client × fabric family (same idea as comparison / clients-by-price). */
function buildKartelaByClientBase(rows: OrderRow[]): Map<string, number> {
  const kartelaByClientBase = new Map<string, number>();
  for (const r of rows) {
    const cid = String(r.client_id ?? "").trim();
    if (!cid) continue;
    const pname = String(r.product_name ?? "");
    if (!isKartelaProductName(pname)) continue;
    const qty = Math.round(Number(r.quantity)) || 0;
    const base = kartelaFamilyBaseKey(pname);
    const k = `${cid}|${base}`;
    kartelaByClientBase.set(k, (kartelaByClientBase.get(k) ?? 0) + qty);
  }
  return kartelaByClientBase;
}

function rowKartelaDisplay(r: OrderRow, kartelaByClientBase: Map<string, number>): string {
  const pname = String(r.product_name ?? "");
  const qty = Math.round(Number(r.quantity)) || 0;
  const cid = String(r.client_id ?? "").trim();

  if (isKartelaProductName(pname)) {
    return qty > 0 ? formatNumber(qty) : "—";
  }
  const base = kartelaFamilyBaseKey(pname);
  const fromMap = cid ? kartelaByClientBase.get(`${cid}|${base}`) ?? 0 : 0;
  if (fromMap > 0) return formatNumber(fromMap);
  const fromBreakdown = kartelaQtyFromMeterBreakdown(r.meter_breakdown);
  return fromBreakdown > 0 ? formatNumber(fromBreakdown) : "—";
}

function invoiceDisplay(r: OrderRow): string {
  const inv = String(r.invoice_ref ?? "").trim();
  if (inv) return inv;
  return "—";
}

function formatOrderDay(iso: string | null | undefined, createdAt: string | null | undefined, locale: string): string {
  const raw = iso || createdAt;
  if (!raw) return "—";
  const t = Date.parse(String(raw));
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function BranchesPage() {
  const { locale, currentUser } = useStore();
  const router = useRouter();
  const isRTL = locale === "ar";

  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin") {
      router.push("/dashboard");
    }
  }, [currentUser, router]);

  const loadBranches = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await fetch("/api/branches", { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setBranches(json.branches ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
      setBranches([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  const branchParam = useMemo(() => {
    if (selectedKey == null) return null;
    return selectedKey === "__none__" ? "__none__" : selectedKey;
  }, [selectedKey]);

  const loadOrders = useCallback(async () => {
    if (branchParam == null) {
      setOrders([]);
      return;
    }
    setLoadingOrders(true);
    setError(null);
    try {
      const q = encodeURIComponent(branchParam);
      const res = await fetch(`/api/branches/orders?branch=${q}&limit=300&offset=0`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setOrders(json.rows ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  }, [branchParam]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const kartelaByClientBase = useMemo(() => buildKartelaByClientBase(orders), [orders]);

  const filteredBranches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => {
      const display =
        b.branch != null && String(b.branch).trim() !== ""
          ? String(b.branch).trim()
          : isRTL
            ? "(بدون فرع)"
            : "(No branch)";
      return display.toLowerCase().includes(q);
    });
  }, [branches, search, isRTL]);

  const t = {
    title: isRTL ? "الفروع" : "Branches",
    subtitle: isRTL ? "تصفح الفروع، ثم افتح تفاصيل الطلبات والأسطر لكل فرع." : "Browse branches, then open order lines and totals for each branch.",
    orderLines: isRTL ? "سطر طلب" : "order lines",
    revenue: isRTL ? "الإيرادات" : "Revenue",
    pick: isRTL ? "الفروع" : "Branches",
    pickHint: isRTL ? "ابحث واختر فرعاً لعرض الجدول." : "Search and pick a branch to load the table.",
    none: isRTL ? "(بدون فرع)" : "(No branch)",
    client: isRTL ? "العميل" : "Client",
    product: isRTL ? "المنتج" : "Product",
    kartela: isRTL ? "كارتيلا" : "Kartela",
    sp: isRTL ? "المندوب" : "Sales",
    period: isRTL ? "الفترة" : "Period",
    meters: isRTL ? "متر" : "Meters",
    ref: isRTL ? "الفاتورة" : "Invoice",
    dateDay: isRTL ? "التاريخ" : "Date",
    access: isRTL ? "غير مصرح" : "Access denied",
    refreshList: isRTL ? "تحديث القائمة" : "Refresh list",
    refreshOrders: isRTL ? "تحديث الطلبات" : "Refresh orders",
    searchPh: isRTL ? "بحث في أسماء الفروع…" : "Search branches…",
    clearSearch: isRTL ? "مسح" : "Clear",
    emptyList: isRTL ? "لا توجد فروع بعد رفع بيانات تحتوي عمود الفرع." : "No branches yet — upload data with a Branch column.",
    choosePrompt: isRTL ? "اختر فرعاً لعرض كل الأسطر." : "Select a branch to load every order line.",
    noOrders: isRTL ? "لا توجد طلبات لهذا الفرع." : "No orders for this branch.",
    details: isRTL ? "تفاصيل الطلبات" : "Order lines",
    backList: isRTL ? "الفروع" : "Branches",
    countLabel: isRTL ? "فرع" : "branches",
  };

  if (currentUser?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-muted-foreground font-sans">
        <div className="rounded-full bg-muted p-4">
          <Building2 className="h-10 w-10" />
        </div>
        <p className="text-sm">{t.access}</p>
      </div>
    );
  }

  const selectedLabel = selectedKey === null ? null : selectedKey === "__none__" ? t.none : selectedKey;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-1 font-sans">
      <PageBack locale={locale} fallbackHref="/dashboard" />

      {/* Page header */}
      <header className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card to-muted/30 p-6 shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-inner">
                <Building2 className="h-6 w-6" aria-hidden />
              </span>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t.title}</h1>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">{t.subtitle}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void loadBranches()}
              disabled={loadingList}
              className="gap-2 shadow-sm"
            >
              {loadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t.refreshList}
            </Button>
            {selectedKey != null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadOrders()}
                disabled={loadingOrders}
                className="gap-2"
              >
                {loadingOrders ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t.refreshOrders}
              </Button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* Branch picker */}
        <Card className="h-fit overflow-hidden border-border/80 shadow-md ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
          <CardHeader className="space-y-3 border-b border-border/60 bg-muted/20 pb-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-lg font-semibold tracking-tight">{t.pick}</CardTitle>
                <CardDescription className="mt-1.5 text-sm">{t.pickHint}</CardDescription>
              </div>
              {!loadingList && branches.length > 0 && (
                <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium tabular-nums text-primary">
                  {branches.length} {t.countLabel}
                </span>
              )}
            </div>
            <div className="relative">
              <Search
                className={cn(
                  "pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground",
                  isRTL ? "end-3" : "start-3"
                )}
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchPh}
                className={cn(isRTL ? "pe-9 ps-3" : "ps-9 pe-9")}
                aria-label={t.searchPh}
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className={cn(
                    "absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                    isRTL ? "start-1.5" : "end-1.5"
                  )}
                  aria-label={t.clearSearch}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="p-3">
            {loadingList ? (
              <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm">{isRTL ? "جارٍ التحميل…" : "Loading branches…"}</p>
              </div>
            ) : branches.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
                <Table2 className="h-10 w-10 text-muted-foreground/70" />
                <p className="text-sm text-muted-foreground">{t.emptyList}</p>
              </div>
            ) : filteredBranches.length === 0 ? (
              <p className="rounded-lg bg-muted/30 px-3 py-8 text-center text-sm text-muted-foreground">
                {isRTL ? "لا نتائج للبحث." : "No branches match your search."}
              </p>
            ) : (
              <ul
                className="scrollbar-thin max-h-[min(65vh,520px)] space-y-1 overflow-y-auto overscroll-contain pe-0.5"
                role="listbox"
                aria-label={t.pick}
              >
                {filteredBranches.map((b) => {
                  const key = b.branch ?? "__none__";
                  const active = selectedKey === key;
                  const label = b.branch ?? t.none;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => setSelectedKey(key)}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-3.5 text-start transition-all",
                          "hover:border-border/80 hover:bg-accent/50 hover:shadow-sm",
                          active && "border-primary/35 bg-primary/[0.08] shadow-sm ring-1 ring-primary/20"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold",
                            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                          )}
                          aria-hidden
                        >
                          {label.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-foreground">{label}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            <span className="tabular-nums">{b.order_count.toLocaleString()}</span> {t.orderLines} ·{" "}
                            <span className="tabular-nums font-medium text-foreground/80">{formatNumber(b.total_revenue)}</span>{" "}
                            EGP
                          </p>
                        </div>
                        <ChevronRight
                          className={cn(
                            "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
                            isRTL && "rotate-180",
                            active ? "text-primary opacity-100" : "opacity-0 group-hover:opacity-100"
                          )}
                          aria-hidden
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Detail table */}
        <Card className="min-h-[320px] overflow-hidden border-border/80 shadow-md ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/15 py-4">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-lg font-semibold tracking-tight">
                {selectedKey == null ? t.details : `${t.details} · ${selectedLabel}`}
              </CardTitle>
              {selectedKey != null && (
                <CardDescription>
                  {orders.length > 0 ? (
                    <>
                      <span className="tabular-nums font-medium text-foreground">{orders.length}</span> {t.orderLines}
                    </>
                  ) : loadingOrders ? null : (
                    t.noOrders
                  )}
                </CardDescription>
              )}
            </div>
            {selectedKey != null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => setSelectedKey(null)}
              >
                <ChevronRight className={cn("h-4 w-4", isRTL ? "" : "rotate-180")} />
                {t.backList}
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {selectedKey == null ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6">
                  <Building2 className="mx-auto h-12 w-12 text-muted-foreground/80" />
                </div>
                <p className="max-w-sm text-sm text-muted-foreground">{t.choosePrompt}</p>
              </div>
            ) : loadingOrders ? (
              <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm">{isRTL ? "جارٍ تحميل الطلبات…" : "Loading orders…"}</p>
              </div>
            ) : (
              <div className="scrollbar-thin max-h-[min(70vh,720px)] overflow-auto">
                <table className="w-full min-w-[880px] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start font-semibold shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80">
                        {t.period}
                      </th>
                      <th className="sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start font-semibold shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 whitespace-nowrap">
                        {t.dateDay}
                      </th>
                      <th className="sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start font-semibold shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80">
                        {t.client}
                      </th>
                      <th className="sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start font-semibold shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80">
                        {t.product}
                      </th>
                      <th className="sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 whitespace-nowrap">
                        {t.kartela}
                      </th>
                      <th className="sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start font-semibold shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80">
                        {t.sp}
                      </th>
                      <th className="sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80 whitespace-nowrap">
                        {t.meters}
                      </th>
                      <th className="sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-end font-semibold shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80">
                        {t.revenue}
                      </th>
                      <th className="sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3 text-start font-semibold font-mono text-[10px] shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80">
                        {t.ref}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {orders.map((r) => (
                      <tr key={r.id} className="bg-card transition-colors hover:bg-muted/40">
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          {r.month}/{r.year}
                        </td>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap text-xs text-foreground">
                          {formatOrderDay(r.invoice_date, r.created_at, locale)}
                        </td>
                        <td className="max-w-[200px] px-3 py-2.5 align-middle">
                          <div className="truncate font-medium text-foreground">{r.client_name}</div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">{r.partner_id}</div>
                        </td>
                        <td className="max-w-[180px] px-3 py-2.5 align-middle text-xs leading-snug text-foreground/95">
                          {r.product_name}
                        </td>
                        <td className="px-3 py-2.5 align-middle text-end tabular-nums text-sm">
                          {rowKartelaDisplay(r, kartelaByClientBase)}
                        </td>
                        <td className="px-3 py-2.5 align-middle text-xs text-muted-foreground">
                          {r.salesperson_name || r.salesperson_code || "—"}
                        </td>
                        <td className="px-3 py-2.5 align-middle text-end tabular-nums font-medium">
                          {formatNumber(r.quantity)}
                        </td>
                        <td className="px-3 py-2.5 align-middle text-end tabular-nums font-medium text-emerald-700 dark:text-emerald-400">
                          {formatNumber(r.invoice_total)}
                        </td>
                        <td className="max-w-[140px] px-3 py-2.5 align-middle font-mono text-[10px] text-foreground/90">
                          <span className="line-clamp-2 break-all" title={invoiceDisplay(r) !== "—" ? invoiceDisplay(r) : undefined}>
                            {invoiceDisplay(r)}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {orders.length === 0 && !loadingOrders && (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                          {t.noOrders}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
