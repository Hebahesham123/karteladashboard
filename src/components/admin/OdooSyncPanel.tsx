"use client";

import { useState } from "react";
import { Database, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStore } from "@/store/useStore";

type SyncResult = {
  success?: boolean;
  error?: string;
  fetchedLines?: number;
  processed?: number;
  failed?: number;
  endpoint?: string;
  debug?: unknown;
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
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setLoading(false);
    }
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
        <p className="text-xs text-muted-foreground">
          {isRTL
            ? "يُفضّل ضبط ODOO_BASE_URL و ODOO_ANALYTICS_API_KEY في .env.local. يمكنك ترك الحقول فارغة إن وُجدت القيم في البيئة."
            : "Prefer ODOO_BASE_URL and ODOO_ANALYTICS_API_KEY in .env.local. Leave fields empty if env vars are set."}
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={isRTL ? "Base URL (اختياري)" : "Base URL (optional)"}
          />
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={isRTL ? "API Key (اختياري)" : "API Key (optional)"}
            type="password"
            autoComplete="off"
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
