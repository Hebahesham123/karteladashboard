"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Layers,
  Loader2,
  MessageSquare,
  Package,
  RefreshCw,
  Ruler,
  Table2,
  UserCheck,
  Users,
} from "lucide-react";
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

interface CommentEntry {
  id: string;
  note: string;
  createdAt: string;
  userName: string;
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
  /** Distinct import categories on meter lines for this client × family. */
  categoryLabels: string[];
  /** Distinct فاتوره / journal refs on lines for this client × family. */
  invoiceRefs: string[];
  /** Distinct branch names from order lines (e.g. Odoo Invoice lines/Branch). */
  branchLabels: string[];
  /** Distinct calendar days (YYYY-MM-DD) from invoice_date or created_at on lines. */
  dayDates: string[];
  /** Distinct Odoo pricelist names (e.g. VIP (EGP)). */
  pricelists: string[];
  comments: CommentEntry[];
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

const KARTELA_CACHE_PREFIX = "kartela_analysis_v2:";

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

function CommentsHover({
  label,
  comments,
  isRTL,
}: {
  label: string;
  comments: CommentEntry[];
  isRTL: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (comments.length === 0) return <span>{label}</span>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className="inline-flex items-center gap-1.5 hover:underline text-start"
        >
          <span className="truncate">{label}</span>
          <MessageSquare className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="text-[11px] text-muted-foreground">({comments.length})</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(92vw,28rem)]"
        align="start"
        dir={isRTL ? "rtl" : "ltr"}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="rounded-md border border-border/70 px-3 py-2">
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">{c.note}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {c.userName} · {new Date(c.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
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
  const [isRefreshing, setIsRefreshing] = useState(false);

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

    const selectedClientIds = filters.selectedClients?.length
      ? filters.selectedClients
      : (filters.selectedClient ? [filters.selectedClient] : []);
    const selectedProductIds = filters.selectedProducts?.length
      ? filters.selectedProducts
      : (filters.selectedProduct ? [filters.selectedProduct] : []);
    const cacheKey = `${KARTELA_CACHE_PREFIX}${month}:${year}:${selectedSpIds.slice().sort().join(",")}:${selectedClientIds.slice().sort().join(",")}:${selectedProductIds.slice().sort().join(",")}`;

    let hydratedFromCache = false;
    if (typeof window !== "undefined") {
      try {
        const raw = window.sessionStorage.getItem(cacheKey);
        if (raw) {
          const cached = JSON.parse(raw) as {
            families: FamilyRow[];
            products: [string, string][];
          };
          if (Array.isArray(cached?.families) && Array.isArray(cached?.products)) {
            setFamilies(cached.families);
            setProductNameById(new Map(cached.products));
            setLoading(false);
            hydratedFromCache = true;
          }
        }
      } catch {
        // Ignore invalid cache payload.
      }
    }

    if (hydratedFromCache) setIsRefreshing(true);
    else setLoading(true);
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

      const [{ data: spRows }, { data: productRows }] = await Promise.all([
        supabase.from("salespersons").select("id, name"),
        supabase.from("products").select("id, name"),
      ]);
      const spNameById = new Map<string, string>(
        (spRows ?? []).map((s: any) => [s.id as string, String(s.name ?? "")])
      );
      const productNameMap = new Map((productRows ?? []).map((p: any) => [p.id as string, String(p.name ?? "")]));
      setProductNameById(productNameMap);

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
      const scopedAllowedIds = selectedClientIds.length > 0
        ? allowedIds.filter((id) => selectedClientIds.includes(id))
        : allowedIds;

      const selectedBaseSet = selectedProductIds.length > 0
        ? new Set(
            selectedProductIds
              .map((id) => productNameMap.get(id))
              .filter(Boolean)
              .map((name) => kartelaFamilyBaseKey(name!))
          )
        : null;

      if (scopedAllowedIds.length === 0) {
        setFamilies([]);
        setLoading(false);
        return;
      }

      const orderRows: any[] = [];
      const CHUNK = 120;
      const PARALLEL_BATCH = 6;
      const chunks: string[][] = [];
      for (let i = 0; i < scopedAllowedIds.length; i += CHUNK) {
        chunks.push(scopedAllowedIds.slice(i, i + CHUNK));
      }
      for (let i = 0; i < chunks.length; i += PARALLEL_BATCH) {
        const batch = chunks.slice(i, i + PARALLEL_BATCH);
        const results = await Promise.all(
          batch.map((chunk) =>
            supabase
              .from("orders")
              .select(
                "client_id, quantity, invoice_total, salesperson_id, meter_breakdown, category, invoice_ref, branch, invoice_date, created_at, pricelist, products(name)"
              )
              .eq("month", month)
              .eq("year", year)
              .in("client_id", chunk)
          )
        );
        results.forEach(({ data, error: oe }) => {
          if (oe) throw new Error(oe.message);
          orderRows.push(...(data ?? []));
        });
      }

      const commentsByClient = new Map<string, CommentEntry[]>();
      try {
        const NOTE_CHUNK = 150;
        const noteRowsAll: any[] = [];
        for (let i = 0; i < scopedAllowedIds.length; i += NOTE_CHUNK) {
          const noteChunk = scopedAllowedIds.slice(i, i + NOTE_CHUNK);
          const { data: noteRows, error: noteErr } = await supabase
            .from("activity_logs")
            .select("id, entity_id, user_id, metadata, created_at")
            .eq("activity_type", "NOTE_ADDED")
            .in("entity_id", noteChunk)
            .order("created_at", { ascending: false });
          if (noteErr) continue;
          noteRowsAll.push(...(noteRows ?? []));
        }

        const userIds = Array.from(
          new Set(
            noteRowsAll
              .map((r) => (r?.user_id ? String(r.user_id) : ""))
              .filter(Boolean)
          )
        );
        let userNameById = new Map<string, string>();
        if (userIds.length > 0) {
          const { data: userRows } = await supabase.from("users").select("id, full_name").in("id", userIds);
          userNameById = new Map((userRows ?? []).map((u: any) => [String(u.id), String(u.full_name ?? "—")]));
        }

        noteRowsAll.forEach((row: any) => {
          const clientId = String(row.entity_id ?? "");
          if (!clientId) return;
          const note = String(row.metadata?.note ?? "").trim();
          if (!note) return;
          if (!commentsByClient.has(clientId)) commentsByClient.set(clientId, []);
          const uid = row?.user_id ? String(row.user_id) : "";
          commentsByClient.get(clientId)!.push({
            id: String(row.id),
            note,
            createdAt: String(row.created_at),
            userName: uid ? userNameById.get(uid) ?? "—" : "—",
          });
        });
      } catch {
        // Notes history is best-effort; never block table loading.
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
            categoryLabels: [],
            invoiceRefs: [],
            branchLabels: [],
            dayDates: [],
            pricelists: [],
            comments: commentsByClient.get(cid) ?? [],
          });
        }
        return m.get(cid)!;
      };

      for (const row of orderRows) {
        const pname = productNameFromRow(row);
        if (!pname) continue;
        const base = kartelaFamilyBaseKey(pname);
        if (selectedBaseSet && !selectedBaseSet.has(base)) continue;
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
        const cat = row.category != null ? String(row.category).trim() : "";
        const iref = String(row.invoice_ref ?? "").trim();
        const pl = row.pricelist != null ? String(row.pricelist).trim() : "";
        const brName = row.branch != null ? String(row.branch).trim() : "";
        if (brName && !ac.branchLabels.includes(brName)) ac.branchLabels.push(brName);
        const invDay =
          row.invoice_date != null && String(row.invoice_date).trim() !== ""
            ? String(row.invoice_date).trim().slice(0, 10)
            : row.created_at != null && String(row.created_at).trim() !== ""
              ? String(row.created_at).slice(0, 10)
              : "";
        if (invDay && !ac.dayDates.includes(invDay)) ac.dayDates.push(invDay);
        if (iref && !ac.invoiceRefs.includes(iref)) ac.invoiceRefs.push(iref);
        if (kartela) {
          ac.kartelaQtySheet += qty;
          ac.kartelaRevenue += inv;
          if (cat && !ac.categoryLabels.includes(cat)) ac.categoryLabels.push(cat);
          if (pl && !ac.pricelists.includes(pl)) ac.pricelists.push(pl);
        } else {
          ac.meterQty += qty;
          ac.meterRevenue += inv;
          const br = parseMeterBreakdown(row.meter_breakdown);
          if (br.length) ac.meterBreakdown.push(...br);
          if (cat && !ac.categoryLabels.includes(cat)) ac.categoryLabels.push(cat);
          if (pl && !ac.pricelists.includes(pl)) ac.pricelists.push(pl);
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
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(
            cacheKey,
            JSON.stringify({
              families: out,
              products: Array.from(productNameMap.entries()),
            })
          );
        } catch {
          // Ignore session storage errors.
        }
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? (isRTL ? "تعذر التحميل" : "Failed to load"));
      setFamilies([]);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [
    currentUser, salespersonId, selectedSpIds, month, year, isRTL,
    filters.selectedClient, filters.selectedClients, filters.selectedProduct, filters.selectedProducts,
  ]);

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
    avgMeter: isRTL ? "متوسط سعر المتر" : "Avg / meter",
    details: isRTL ? "تفاصيل العملاء" : "Client details",
    partner: isRTL ? "الرقم" : "Partner",
    client: isRTL ? "العميل" : "Client",
    branch: isRTL ? "الفرع" : "Branch",
    invoice: isRTL ? "فاتورة / مرجع" : "Invoice",
    dayDate: isRTL ? "تاريخ اليوم" : "Day date",
    refresh: isRTL ? "تحديث" : "Refresh",
    empty: isRTL ? "لا توجد طلبات في هذه الفترة" : "No orders in this period",
    access: isRTL ? "غير مصرح" : "Access denied",
    meterBreakdownHint: isRTL ? "تفاصيل الأمتار حسب اللون / الصفة" : "Meters by color / variant",
    families: isRTL ? "عدد الخطوط" : "Families",
    tableTitle: isRTL ? "ملخص الخطوط" : "Line summary",
    tableSubtitle: isRTL ? "اضغط «تفاصيل» لعرض العملاء والفروع والفواتير." : "Use Details to open clients, branches, and invoices.",
  };

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
    const selectedClientIds = selectedClients.length > 0
      ? selectedClients
      : (filters.selectedClient ? [filters.selectedClient] : []);
    const selectedClientSet = selectedClientIds.length > 0 ? new Set(selectedClientIds) : null;
    return families
      .filter((f) => (selectedProductBase ? selectedProductBase.has(f.baseName) : true))
      .map((f) => {
        const filteredClients = f.clients.filter((c) => {
          if (selectedClientSet && !selectedClientSet.has(c.clientId)) return false;
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

  const stats = useMemo(() => {
    let totalMeters = 0;
    let totalKartela = 0;
    let clientsMeters = 0;
    let clientsKartela = 0;
    visibleFamilies.forEach((f) => {
      totalMeters += f.totalMeterQty;
      totalKartela += f.totalKartelaQty;
      clientsMeters += f.clientsWithMeters;
      clientsKartela += f.clientsWithKartela;
    });
    return { totalMeters, totalKartela, clientsMeters, clientsKartela, families: visibleFamilies.length };
  }, [visibleFamilies]);

  if (currentUser && currentUser.role !== "admin" && currentUser.role !== "sales") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-muted-foreground">
        {t.access}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 font-sans antialiased">
      <PageBack locale={locale} fallbackHref="/dashboard" />

      <div className="flex flex-col gap-4 border-b border-border/60 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t.title}</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{t.subtitle}</p>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground/90">{t.imputeNote}</p>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/40 px-3 py-1 text-xs font-medium text-foreground">
            <span className="text-muted-foreground">{t.period}</span>
            <span className="tabular-nums">{monthLabel}</span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-2 border-border/80 shadow-sm"
          onClick={() => fetchData()}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t.refresh}
        </Button>
      </div>
      {isRefreshing && (
        <p className="text-xs text-muted-foreground">
          {isRTL ? "يتم تحديث البيانات في الخلفية..." : "Refreshing data in background..."}
        </p>
      )}

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
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 py-20 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">{isRTL ? "جارٍ التحميل…" : "Loading…"}</p>
        </div>
      ) : visibleFamilies.length === 0 ? (
        <Card className="border-dashed border-border/80 bg-muted/10">
          <CardContent className="py-14 text-center text-muted-foreground">{t.empty}</CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            {[
              { label: t.families, value: stats.families, icon: Layers, accent: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
              { label: t.meterQty, value: formatNumber(Math.round(stats.totalMeters)), icon: Ruler, accent: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
              { label: t.kartelaQty, value: formatNumber(Math.round(stats.totalKartela)), icon: Package, accent: "bg-amber-500/15 text-amber-800 dark:text-amber-200" },
              { label: t.clientsMeters, value: stats.clientsMeters.toLocaleString(), icon: Users, accent: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" },
              { label: t.clientsKartela, value: stats.clientsKartela.toLocaleString(), icon: UserCheck, accent: "bg-rose-500/15 text-rose-800 dark:text-rose-200" },
            ].map((s) => (
              <Card key={s.label} className="overflow-hidden border-border/70 shadow-sm transition-shadow hover:shadow-md">
                <CardContent className="flex items-start gap-3 p-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${s.accent}`}>
                    <s.icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[11px] font-medium text-muted-foreground sm:text-xs ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                    >
                      {s.label}
                    </p>
                    <p className="mt-1 text-xl font-bold tabular-nums tracking-tight text-foreground sm:text-2xl">{s.value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden border-border/80 shadow-md">
            <CardHeader className="space-y-1 border-b border-border/60 bg-gradient-to-b from-muted/50 to-transparent px-4 py-4 sm:px-6">
              <div className="flex items-center gap-2">
                <Table2 className="h-5 w-5 text-primary" aria-hidden />
                <CardTitle className="text-base font-semibold sm:text-lg">{t.tableTitle}</CardTitle>
              </div>
              <CardDescription className="text-xs sm:text-sm">{t.tableSubtitle}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div
                className="max-h-[min(70vh,720px)] overflow-auto overscroll-contain"
                dir={isRTL ? "rtl" : "ltr"}
              >
                <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th
                        className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-4 py-3.5 text-start text-xs font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                      >
                        {t.family}
                      </th>
                      <th
                        className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3.5 text-end text-xs font-semibold text-muted-foreground tabular-nums shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                      >
                        {t.clientsMeters}
                      </th>
                      <th
                        className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3.5 text-end text-xs font-semibold text-muted-foreground tabular-nums shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                      >
                        {t.clientsKartela}
                      </th>
                      <th
                        className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3.5 text-end text-xs font-semibold text-muted-foreground tabular-nums shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                      >
                        {t.meterQty}
                      </th>
                      <th
                        className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3.5 text-end text-xs font-semibold text-muted-foreground tabular-nums shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                      >
                        {t.kartelaQty}
                      </th>
                      <th
                        className={`sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-3.5 text-end text-xs font-semibold text-muted-foreground tabular-nums shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                      >
                        {t.avgMeter}
                      </th>
                      <th
                        className={`sticky top-0 z-20 w-[1%] whitespace-nowrap border-b border-border bg-muted/95 px-4 py-3.5 text-center text-xs font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                      >
                        {t.details}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {visibleFamilies.map((f) => (
                      <Fragment key={f.baseName}>
                        <tr className="group transition-colors hover:bg-muted/50">
                          <td className="px-4 py-3.5 align-middle">
                            <span className="font-semibold text-foreground">{f.baseName}</span>
                          </td>
                          <td className="px-3 py-3.5 text-end tabular-nums text-muted-foreground">
                            {f.clientsWithMeters}
                          </td>
                          <td className="px-3 py-3.5 text-end tabular-nums text-muted-foreground">
                            {f.clientsWithKartela}
                          </td>
                          <td className="px-3 py-3.5 text-end tabular-nums font-medium text-foreground">
                            {formatNumber(Math.round(f.totalMeterQty))}
                          </td>
                          <td className="px-3 py-3.5 text-end tabular-nums font-medium text-foreground">
                            {formatNumber(Math.round(f.totalKartelaQty))}
                          </td>
                          <td className="px-3 py-3.5 text-end tabular-nums text-muted-foreground">
                            {f.avgMeterUnitPrice != null ? Math.round(f.avgMeterUnitPrice).toLocaleString() : "—"}
                          </td>
                          <td className="px-3 py-2 align-middle text-center">
                            <Button
                              variant={expanded === f.baseName ? "secondary" : "outline"}
                              size="sm"
                              className="h-8 gap-1.5 px-3 text-xs font-medium shadow-sm"
                              onClick={() => setExpanded((e) => (e === f.baseName ? null : f.baseName))}
                            >
                              {expanded === f.baseName ? (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-80" />
                              )}
                              <span className="hidden sm:inline">{t.details}</span>
                            </Button>
                          </td>
                        </tr>
                        {expanded === f.baseName && (
                          <tr className="bg-muted/25">
                            <td colSpan={7} className="p-0">
                              <div className="border-t border-border/60 p-3 sm:p-4">
                                <div className="max-h-[min(50vh,520px)] overflow-auto overscroll-contain rounded-xl border border-border/70 bg-card shadow-inner">
                                  <table className="w-full min-w-[980px] border-separate border-spacing-0 text-xs sm:text-sm">
                                    <thead>
                                      <tr className="border-b border-border/80">
                                        <th
                                          className={`sticky top-0 z-10 border-b border-border/80 bg-muted/95 px-3 py-2.5 text-start text-[11px] font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                                        >
                                          {t.partner}
                                        </th>
                                        <th
                                          className={`sticky top-0 z-10 border-b border-border/80 bg-muted/95 px-3 py-2.5 text-start text-[11px] font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                                        >
                                          {t.client}
                                        </th>
                                        <th
                                          className={`sticky top-0 z-10 border-b border-border/80 bg-muted/95 px-3 py-2.5 text-start text-[11px] font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                                        >
                                          {t.branch}
                                        </th>
                                        <th
                                          className={`sticky top-0 z-10 border-b border-border/80 bg-muted/95 px-3 py-2.5 text-start text-[11px] font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                                        >
                                          {t.invoice}
                                        </th>
                                        <th
                                          className={`sticky top-0 z-10 whitespace-nowrap border-b border-border/80 bg-muted/95 px-3 py-2.5 text-start text-[11px] font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                                        >
                                          {t.dayDate}
                                        </th>
                                        <th
                                          className={`sticky top-0 z-10 border-b border-border/80 bg-muted/95 px-3 py-2.5 text-start text-[11px] font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                                        >
                                          {t.salesperson}
                                        </th>
                                        <th
                                          className={`sticky top-0 z-10 border-b border-border/80 bg-muted/95 px-3 py-2.5 text-end text-[11px] font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                                        >
                                          {t.meterQty}
                                        </th>
                                        <th
                                          className={`sticky top-0 z-10 border-b border-border/80 bg-muted/95 px-3 py-2.5 text-end text-[11px] font-semibold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-muted/90 ${isRTL ? "tracking-normal" : "uppercase tracking-wide"}`}
                                        >
                                          {t.kartelaQty}
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                      {f.clients.map((c) => {
                                        const branchesShow = [...c.branchLabels].sort((a, b) =>
                                          a.localeCompare(b, undefined, { sensitivity: "base" })
                                        );
                                        const daysShow = [...c.dayDates].sort();
                                        return (
                                          <tr key={c.clientId} className="bg-background/80 transition-colors hover:bg-muted/30">
                                            <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                                              {c.partnerId}
                                            </td>
                                            <td className="px-3 py-2.5 font-medium max-w-[220px]">
                                              <CommentsHover label={c.name} comments={c.comments} isRTL={isRTL} />
                                            </td>
                                            <td
                                              className="max-w-[140px] px-3 py-2.5 align-top text-xs text-muted-foreground"
                                              title={branchesShow.join(", ")}
                                            >
                                              {branchesShow.length ? (
                                                <span className="line-clamp-3 break-words">{branchesShow.join(", ")}</span>
                                              ) : (
                                                "—"
                                              )}
                                            </td>
                                            <td
                                              className="max-w-[160px] px-3 py-2.5 align-top font-mono text-[11px] text-muted-foreground"
                                              title={c.invoiceRefs.join(", ")}
                                            >
                                              {c.invoiceRefs.length ? (
                                                <span className="line-clamp-4 break-all">{c.invoiceRefs.join(", ")}</span>
                                              ) : (
                                                "—"
                                              )}
                                            </td>
                                            <td
                                              className="max-w-[120px] px-3 py-2.5 align-top text-xs tabular-nums text-muted-foreground whitespace-pre-wrap"
                                              title={daysShow.join(", ")}
                                            >
                                              {daysShow.length ? daysShow.join(", ") : "—"}
                                            </td>
                                            <td className="max-w-[140px] truncate px-3 py-2.5 text-xs" title={c.salespersonName ?? ""}>
                                              <CommentsHover label={c.salespersonName ?? "—"} comments={c.comments} isRTL={isRTL} />
                                            </td>
                                            <td className="px-3 py-2.5 text-end">
                                              <MeterBreakdownCell
                                                total={c.meterQty}
                                                lines={c.meterBreakdown}
                                                isRTL={isRTL}
                                                labelShow={t.meterBreakdownHint}
                                              />
                                            </td>
                                            <td className="px-3 py-2.5 text-end tabular-nums font-medium text-foreground">
                                              {formatNumber(c.kartelaQty)}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
