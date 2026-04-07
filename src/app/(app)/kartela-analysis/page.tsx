"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";
import { ALLOWED_CUSTOMER_TYPES } from "@/lib/customerTypes";
import { isKartelaProductName, kartelaFamilyBaseKey } from "@/lib/kartelaProduct";
import { formatNumber } from "@/lib/utils";
import { FilterBar } from "@/components/shared/FilterBar";
import { PageBack } from "@/components/layout/PageBack";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface MeterBreakdownLine {
  label: string;
  meters: number;
}

interface ClientAgg {
  clientId: string;
  name: string;
  partnerId: string;
  customerType: string | null;
  salespersonName: string | null;
  /** When true, salespersonName came from a كارتله order line (prefer over meter-only lines). */
  spFromKartelaLine: boolean;
  meterQty: number;
  meterRevenue: number;
  /** Concatenated variant/color lines from uploaded orders (Excel). */
  meterBreakdown: MeterBreakdownLine[];
  /** Sum of kartela lines from the sheet/DB (explicit كارتله products). */
  kartelaQtySheet: number;
  /** Sheet qty when present; otherwise 1 if meters without sheet kartela; else 0. */
  kartelaQty: number;
  kartelaRevenue: number;
}

interface FamilyRow {
  baseName: string;
  totalMeterQty: number;
  totalKartelaQty: number;
  meterRevenue: number;
  kartelaRevenue: number;
  clientsWithMeters: number;
  clientsWithKartela: number;
  kartelaOnlyClients: number;
  avgMeterUnitPrice: number | null;
  topKartelaNoMeters: { name: string; partnerId: string; kartelaQty: number; customerType: string | null }[];
  clients: ClientAgg[];
}

function parseMeterBreakdown(raw: unknown): MeterBreakdownLine[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((x: any) => ({
      label: String(x?.label ?? x?.name ?? "").trim(),
      meters: Number(x?.meters) || 0,
    }))
    .filter((x) => x.label && x.meters > 0);
}

function formatMetersDetail(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function MeterBreakdownCell({
  total,
  lines,
  isRTL,
  labelShow,
}: {
  total: number;
  lines: MeterBreakdownLine[];
  isRTL: boolean;
  labelShow: string;
}) {
  if (lines.length === 0) {
    return <span className="tabular-nums">{formatNumber(total)}</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="tabular-nums text-blue-600 dark:text-blue-400 hover:underline font-semibold rounded px-0.5 -mx-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={labelShow}
        >
          {formatNumber(total)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end" dir={isRTL ? "rtl" : "ltr"}>
        <p className="text-lg font-bold text-blue-600 dark:text-blue-400 tabular-nums mb-3">
          {formatMetersDetail(total)}m
        </p>
        <ul className="text-xs text-muted-foreground space-y-2 max-h-64 overflow-y-auto">
          {lines.map((line, i) => (
            <li key={`${line.label}-${i}`} className="border-b border-border/60 pb-2 last:border-0 last:pb-0">
              <div className="text-foreground/90 font-medium">{line.label}:</div>
              <div className="tabular-nums mt-0.5">
                {formatMetersDetail(line.meters)}m
                {i < lines.length - 1 ? <span className="text-muted-foreground ms-1">+</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function productNameFromRow(row: { products?: { name?: string } | null }): string | null {
  const p = row.products as { name?: string } | { name?: string }[] | null | undefined;
  if (!p) return null;
  if (Array.isArray(p)) return p[0]?.name ?? null;
  return p.name ?? null;
}

export default function KartelaAnalysisPage() {
  const router = useRouter();
  const { locale, filters, currentUser, salespersonId } = useStore();
  const isRTL = locale === "ar";

  const [loading, setLoading] = useState(true);
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [productNameById, setProductNameById] = useState<Map<string, string>>(new Map());

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

  const fetchData = useCallback(async () => {
    if (!currentUser) return;
    if (currentUser.role === "sales" && !salespersonId) {
      setFamilies([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const supabase = createClient();

    try {
      let clientQuery = supabase
        .from("clients")
        .select("id, name, partner_id, customer_type, salesperson_id")
        .in("customer_type", [...ALLOWED_CUSTOMER_TYPES]);

      if (selectedSpIds.length === 1) clientQuery = clientQuery.eq("salesperson_id", selectedSpIds[0]);
      else if (selectedSpIds.length > 1) clientQuery = clientQuery.in("salesperson_id", selectedSpIds);

      const { data: clientRows, error: clientErr } = await clientQuery;
      if (clientErr) throw new Error(clientErr.message);

      const { data: spRows } = await supabase.from("salespersons").select("id, name");
      const { data: productRows } = await supabase.from("products").select("id, name");
      const spNameById = new Map<string, string>(
        (spRows ?? []).map((s: any) => [s.id as string, String(s.name ?? "")])
      );
      setProductNameById(
        new Map((productRows ?? []).map((p: any) => [p.id as string, String(p.name ?? "")]))
      );

      const clientMap = new Map(
        (clientRows ?? []).map((c: any) => {
          const sid = c.salesperson_id as string | null;
          return [
            c.id as string,
            {
              id: c.id as string,
              name: c.name as string,
              partner_id: c.partner_id as string,
              customer_type: (c.customer_type as string) ?? null,
              salespersonName: sid ? spNameById.get(sid) ?? null : null,
            },
          ];
        })
      );

      const allowedIds = Array.from(clientMap.keys());
      if (allowedIds.length === 0) {
        setFamilies([]);
        setLoading(false);
        return;
      }

      const orderRows: any[] = [];
      const CHUNK = 100;
      for (let i = 0; i < allowedIds.length; i += CHUNK) {
        const chunk = allowedIds.slice(i, i + CHUNK);
        // Scope by client's assigned rep only — do not filter orders.salesperson_id.
        // Invoice lines may list a different rep than the client's owner; those rows must still appear.
        const q = supabase
          .from("orders")
          .select("client_id, quantity, invoice_total, salesperson_id, meter_breakdown, products(name)")
          .eq("month", month)
          .eq("year", year)
          .in("client_id", chunk);
        const { data, error: oe } = await q;
        if (oe) throw new Error(oe.message);
        orderRows.push(...(data ?? []));
      }

      const byFamily = new Map<string, Map<string, ClientAgg>>();

      const ensure = (base: string, cid: string): ClientAgg => {
        if (!byFamily.has(base)) byFamily.set(base, new Map());
        const m = byFamily.get(base)!;
        if (!m.has(cid)) {
          const c = clientMap.get(cid)!;
          m.set(cid, {
            clientId: cid,
            name: c.name,
            partnerId: c.partner_id,
            customerType: c.customer_type,
            salespersonName: c.salespersonName,
            spFromKartelaLine: false,
            meterQty: 0,
            meterRevenue: 0,
            meterBreakdown: [],
            kartelaQtySheet: 0,
            kartelaQty: 0,
            kartelaRevenue: 0,
          });
        }
        return m.get(cid)!;
      };

      for (const row of orderRows) {
        const pname = productNameFromRow(row);
        if (!pname) continue;
        const base = kartelaFamilyBaseKey(pname);
        const kartela = isKartelaProductName(pname);
        const ac = ensure(base, row.client_id as string);
        const sid = row.salesperson_id as string | null;
        if (sid) {
          const lineName = spNameById.get(sid);
          if (lineName) {
            if (kartela) {
              ac.salespersonName = lineName;
              ac.spFromKartelaLine = true;
            } else if (!ac.spFromKartelaLine) {
              ac.salespersonName = lineName;
            }
          }
        }
        const qty = Number(row.quantity) || 0;
        const inv = Number(row.invoice_total) || 0;
        if (kartela) {
          ac.kartelaQtySheet += qty;
          ac.kartelaRevenue += inv;
        } else {
          ac.meterQty += qty;
          ac.meterRevenue += inv;
          const br = parseMeterBreakdown(row.meter_breakdown);
          if (br.length) ac.meterBreakdown.push(...br);
        }
      }

      // Sheet kartela qty as stored; if none on sheet but meters exist → 1 (business rule).
      byFamily.forEach((map) => {
        map.forEach((ac) => {
          ac.kartelaQty =
            ac.kartelaQtySheet > 0 ? ac.kartelaQtySheet : ac.meterQty > 0 ? 1 : 0;
        });
      });

      const out: FamilyRow[] = [];

      byFamily.forEach((clientMapForBase, baseName) => {
        const clients = Array.from(clientMapForBase.values());
        let totalMeterQty = 0;
        let totalKartelaQty = 0;
        let meterRevenue = 0;
        let kartelaRevenue = 0;
        const withMeters = new Set<string>();
        const withKartela = new Set<string>();

        for (const c of clients) {
          totalMeterQty += c.meterQty;
          totalKartelaQty += c.kartelaQty;
          meterRevenue += c.meterRevenue;
          kartelaRevenue += c.kartelaRevenue;
          if (c.meterQty > 0) withMeters.add(c.clientId);
          if (c.kartelaQty > 0) withKartela.add(c.clientId);
        }

        const kartelaOnlyClients = Array.from(withKartela).filter((id) => !withMeters.has(id)).length;

        const topKartelaNoMeters = clients
          .filter((c) => c.kartelaQtySheet > 0 && c.meterQty === 0)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
          .slice(0, 8)
          .map((c) => ({
            name: c.name,
            partnerId: c.partnerId,
            kartelaQty: c.kartelaQtySheet,
            customerType: c.customerType,
          }));

        const avgMeterUnitPrice =
          totalMeterQty > 0 ? meterRevenue / totalMeterQty : null;

        out.push({
          baseName,
          totalMeterQty,
          totalKartelaQty,
          meterRevenue,
          kartelaRevenue,
          clientsWithMeters: withMeters.size,
          clientsWithKartela: withKartela.size,
          kartelaOnlyClients,
          avgMeterUnitPrice,
          topKartelaNoMeters,
          clients: clients.sort((a, b) => {
            const dm = a.meterQty - b.meterQty;
            if (dm !== 0) return dm;
            return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          }),
        });
      });

      out.sort((a, b) => {
        const dm = a.totalMeterQty - b.totalMeterQty;
        if (dm !== 0) return dm;
        return a.baseName.localeCompare(b.baseName, undefined, { sensitivity: "base" });
      });
      setFamilies(out);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? (isRTL ? "تعذر التحميل" : "Failed to load"));
      setFamilies([]);
    } finally {
      setLoading(false);
    }
  }, [currentUser, salespersonId, selectedSpIds, month, year]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin" && currentUser.role !== "sales") {
      router.push("/dashboard");
    }
  }, [currentUser, router]);

  const monthLabel = useMemo(() => {
    const ar = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
    const en = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const m = (month ?? 1) - 1;
    return `${isRTL ? ar[m] : en[m]} ${year}`;
  }, [month, year, isRTL]);

  const t = {
    title: isRTL ? "تحليل وتتبع الكارتيلا" : "Kartela analysis & tracking",
    subtitle: isRTL
      ? "لكل خط أقمشة: أمتار مقابل كارتيلا، العملاء، المتوسطات، والتفاصيل الزمنية"
      : "Per fabric line: meters vs kartela samples, clients, averages, and purchase timing",
    imputeNote: isRTL
      ? "كمية الكارتيلا من الملف تُعرض كما هي؛ إن لم تُذكر ومعها أمتار تُحسب 1."
      : "Kartela qty follows the sheet when present; if missing but there are meters, it is set to 1.",
    salesperson: isRTL ? "المندوب" : "Salesperson",
    period: isRTL ? "الفترة" : "Period",
    family: isRTL ? "الخط / المنتج" : "Fabric / product",
    meterQty: isRTL ? "أمتار" : "Meters",
    kartelaQty: isRTL ? "كمية كارتيلا" : "Kartela qty",
    clientsMeters: isRTL ? "عملاء بأمتار" : "Clients (meters)",
    clientsKartela: isRTL ? "عملاء بكارتيلا" : "Clients (kartela)",
    kartelaOnly: isRTL ? "كارتيلا بدون أمتار (هذا الخط)" : "Kartela only (this line)",
    avgMeter: isRTL ? "متوسط سعر المتر" : "Avg / meter",
    topNoMeters: isRTL ? "أعلى كارتيلا — بدون أمتار على هذا الخط" : "Top kartela — no meters on this line",
    details: isRTL ? "تفاصيل العملاء" : "Client details",
    partner: isRTL ? "الرقم" : "Partner",
    type: isRTL ? "النوع" : "Type",
    refresh: isRTL ? "تحديث" : "Refresh",
    empty: isRTL ? "لا توجد طلبات في هذه الفترة" : "No orders in this period",
    access: isRTL ? "غير مصرح" : "Access denied",
    meterBreakdownHint: isRTL ? "تفاصيل الأمتار حسب اللون / الصفة" : "Meters by color / variant",
  };

  if (currentUser && currentUser.role !== "admin" && currentUser.role !== "sales") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-muted-foreground">
        {t.access}
      </div>
    );
  }

  const selectedProductBase = useMemo(() => {
    const selectedProducts = filters.selectedProducts ?? [];
    const ids = selectedProducts.length > 0
      ? selectedProducts
      : (filters.selectedProduct ? [filters.selectedProduct] : []);
    if (ids.length === 0) return null;
    const out = new Set<string>();
    ids.forEach((id) => {
      const n = productNameById.get(id);
      if (n) out.add(kartelaFamilyBaseKey(n));
    });
    return out;
  }, [filters.selectedProduct, filters.selectedProducts, productNameById]);

  const visibleFamilies = useMemo(() => {
    const selectedClients = filters.selectedClients ?? [];
    return families
      .filter((f) => (selectedProductBase ? selectedProductBase.has(f.baseName) : true))
      .map((f) => {
        const filteredClients = f.clients.filter((c) => {
          const selectedClientIds = selectedClients.length > 0
            ? selectedClients
            : (filters.selectedClient ? [filters.selectedClient] : []);
          if (selectedClientIds.length > 0 && !selectedClientIds.includes(c.clientId)) return false;
          return c.meterQty > 0 || c.kartelaQty > 0;
        });
        if (filteredClients.length === 0) return null;
        return {
          ...f,
          clients: filteredClients,
          totalMeterQty: filteredClients.reduce((s, c) => s + c.meterQty, 0),
          totalKartelaQty: filteredClients.reduce((s, c) => s + c.kartelaQty, 0),
          clientsWithMeters: filteredClients.filter((c) => c.meterQty > 0).length,
          clientsWithKartela: filteredClients.filter((c) => c.kartelaQty > 0).length,
          kartelaOnlyClients: filteredClients.filter((c) => c.kartelaQty > 0 && c.meterQty === 0).length,
        };
      })
      .filter((f): f is FamilyRow => Boolean(f));
  }, [families, selectedProductBase, filters.selectedClient, filters.selectedClients]);

  return (
    <div className="space-y-5">
      <PageBack locale={locale} fallbackHref="/dashboard" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t.subtitle}</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{t.imputeNote}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t.period}: <span className="font-semibold text-foreground">{monthLabel}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => fetchData()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t.refresh}
        </Button>
      </div>

      <FilterBar
        locale={locale}
        showSalesperson={currentUser?.role === "admin"}
        showClient
        showStatus={false}
        showLevel={false}
        showProduct
        multiSelectDropdowns
      />

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : visibleFamilies.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">{t.empty}</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {visibleFamilies.map((f) => (
            <Card key={f.baseName} className="overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg">{f.baseName}</CardTitle>
                    <CardDescription className="mt-1">
                      {t.clientsMeters}: <strong>{f.clientsWithMeters}</strong>
                      {" · "}
                      {t.clientsKartela}: <strong>{f.clientsWithKartela}</strong>
                      {" · "}
                      {t.kartelaOnly}: <strong>{f.kartelaOnlyClients}</strong>
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 shrink-0"
                    onClick={() => setExpanded((e) => (e === f.baseName ? null : f.baseName))}
                  >
                    {expanded === f.baseName ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    {t.details}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm max-w-2xl">
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <p className="text-[10px] text-muted-foreground uppercase">{t.meterQty}</p>
                    <p className="font-bold tabular-nums">{formatNumber(Math.round(f.totalMeterQty))}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <p className="text-[10px] text-muted-foreground uppercase">{t.kartelaQty}</p>
                    <p className="font-bold tabular-nums">{formatNumber(Math.round(f.totalKartelaQty))}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <p className="text-[10px] text-muted-foreground uppercase">{t.avgMeter}</p>
                    <p className="font-bold tabular-nums">
                      {f.avgMeterUnitPrice != null ? Math.round(f.avgMeterUnitPrice).toLocaleString() : "—"}
                    </p>
                  </div>
                </div>

                {f.topKartelaNoMeters.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">{t.topNoMeters}</p>
                    <ul className="flex flex-wrap gap-2">
                      {f.topKartelaNoMeters.map((c) => (
                        <li
                          key={c.partnerId + c.name}
                          className="text-xs rounded-full border border-border px-2.5 py-1 bg-background"
                        >
                          <span className="font-medium">{c.name}</span>
                          <span className="text-muted-foreground mx-1">·</span>
                          <span className="tabular-nums">{formatNumber(c.kartelaQty)}</span>
                          {c.customerType && (
                            <span className="text-muted-foreground ms-1">({c.customerType})</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {expanded === f.baseName && (
                  <div className="rounded-lg border border-border overflow-x-auto">
                    <table className="w-full text-sm caption-bottom">
                      <thead>
                        <tr className="border-b border-border bg-muted/50 text-left rtl:text-right">
                          <th className="p-2 font-medium">{t.partner}</th>
                          <th className="p-2 font-medium">{isRTL ? "العميل" : "Client"}</th>
                          <th className="p-2 font-medium">{t.salesperson}</th>
                          <th className="p-2 font-medium">{t.type}</th>
                          <th className="p-2 font-medium text-end">{t.meterQty}</th>
                          <th className="p-2 font-medium text-end">{t.kartelaQty}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {f.clients.map((c) => (
                            <tr key={c.clientId} className="border-b border-border/80 last:border-0">
                              <td className="p-2 font-mono text-xs text-muted-foreground">{c.partnerId}</td>
                              <td className="p-2 font-medium">{c.name}</td>
                              <td className="p-2 text-xs max-w-[140px] truncate" title={c.salespersonName ?? ""}>
                                {c.salespersonName ?? "—"}
                              </td>
                              <td className="p-2 text-xs">{c.customerType ?? "—"}</td>
                              <td className="p-2 text-end">
                                <MeterBreakdownCell
                                  total={c.meterQty}
                                  lines={c.meterBreakdown}
                                  isRTL={isRTL}
                                  labelShow={t.meterBreakdownHint}
                                />
                              </td>
                              <td className="p-2 text-end tabular-nums">{formatNumber(c.kartelaQty)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
