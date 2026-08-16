"use client";

import { useEffect, useState } from "react";
import { Database, RefreshCw, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStore } from "@/store/useStore";

type SyncResult = {
  success?: boolean;
  error?: string;
  trigger?: "cron" | "manual";
  dateFrom?: string;
  dateTo?: string;
  pagesFetched?: number;
  fetchedRows?: number;
  processed?: number;
  skipped?: number;
  orderErrors?: number;
  failReasons?: Record<string, number>;
  firstDbError?: string | null;
  durationMs?: number;
};

type SyncState = {
  source: string;
  last_sync_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_message: string | null;
  records_processed: number;
  records_failed: number;
};

export function OdooSyncPanel() {
  const { locale, currentUser } = useStore();
  const isRTL = locale === "ar";
  const isSuper = Boolean((currentUser as { is_super_admin?: boolean } | null)?.is_super_admin);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [state, setState] = useState<SyncState | null>(null);

  const loadState = async () => {
    try {
      const res = await fetch("/api/odoo/sync", { credentials: "include" });
      const json = (await res.json()) as { state?: SyncState | null };
      setState(json.state ?? null);
    } catch {
      /* non-fatal */
    }
  };

  useEffect(() => {
    if (!isSuper) return;
    loadState();
  }, [isSuper]);

  // Poll status every 5 seconds while a sync is running (manual or cron).
  useEffect(() => {
    if (!isSuper) return;
    if (state?.last_status !== "running" && !loading) return;
    const t = setInterval(loadState, 5000);
    return () => clearInterval(t);
  }, [isSuper, state?.last_status, loading]);

  if (!isSuper) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            {isRTL ? "مزامنة Odoo" : "Odoo sync"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {isRTL ? "متاح لمشرف النظام فقط." : "Super admin only."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const runSync = async () => {
    setLoading(true);
    setResult(null);
    try {
      const body: Record<string, string | number> = {};
      if (baseUrl.trim()) body.baseUrl = baseUrl.trim();
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      if (dateFrom.trim()) body.date_from = dateFrom.trim();
      if (dateTo.trim()) body.date_to = dateTo.trim();

      const res = await fetch("/api/odoo/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as SyncResult;
      setResult(json);
      loadState();
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setLoading(false);
    }
  };

  const fmtDate = (iso: string | null) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString(isRTL ? "ar-EG" : undefined, {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
    } catch { return iso; }
  };

  const statusIcon = (s: string | null | undefined) => {
    if (s === "success") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    if (s === "error") return <AlertCircle className="h-4 w-4 text-red-600" />;
    if (s === "running") return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4" />
          {isRTL ? "مزامنة Odoo → Supabase" : "Odoo → Supabase sync"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {state && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
            <div className="flex items-center gap-2">
              {statusIcon(state.last_status)}
              <span className="font-medium">
                {isRTL ? "آخر مزامنة:" : "Last sync:"}
              </span>
              <span>{fmtDate(state.last_sync_at)}</span>
              <span className="text-muted-foreground">
                ({state.last_status ?? "—"})
              </span>
            </div>
            {state.last_message && (
              <div className="text-muted-foreground">{state.last_message}</div>
            )}
            {(state.records_processed > 0 || state.records_failed > 0) && (
              <div className="text-muted-foreground">
                {isRTL ? "تم إدخال" : "Processed"}: <b>{state.records_processed.toLocaleString()}</b>
                {" · "}
                {isRTL ? "تم تخطّي" : "Skipped"}: <b>{state.records_failed.toLocaleString()}</b>
              </div>
            )}
            <div className="text-muted-foreground">
              {isRTL
                ? "تعمل المزامنة تلقائياً كل يوم الساعة 3 صباحاً UTC."
                : "Automatic daily sync runs at 03:00 UTC."}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {isRTL
            ? "يُفضّل ضبط ODOO_API_URL و ODOO_API_TOKEN في .env.local. اترك الحقول فارغة إن كانت القيم مضبوطة في البيئة."
            : "Prefer ODOO_API_URL and ODOO_API_TOKEN in .env.local. Leave fields empty if env vars are set."}
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {/* Chrome saw a text+password pair here and autofilled the login
              email/password into them, which then got POSTed as baseUrl/apiKey
              and broke the sync. autoComplete="off" is ignored on password
              fields; "new-password" is the combination browsers honour. */}
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={isRTL ? "Base URL (اختياري)" : "Base URL (optional)"}
            name="odoo-base-url"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore
          />
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={isRTL ? "API Key (اختياري)" : "API Key (optional)"}
            type="password"
            name="odoo-api-key"
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore
          />
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Input
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="date_from YYYY-MM-DD"
          />
          <Input
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="date_to YYYY-MM-DD"
          />
        </div>
        <Button type="button" onClick={runSync} disabled={loading}>
          {loading ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              {isRTL ? "جارٍ المزامنة..." : "Syncing..."}
            </>
          ) : isRTL ? (
            "تشغيل المزامنة"
          ) : (
            "Run sync"
          )}
        </Button>
        {result && (
          <pre className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-2 text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
