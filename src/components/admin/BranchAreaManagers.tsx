"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDown, Loader2, RefreshCw, Search, Shield, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface Props {
  locale: string;
}

interface ManagerRow {
  user_id: string;
  full_name: string;
  email: string;
  title: string | null;
  type: "branch_manager" | "area_manager";
  branches: string[];
  is_active: boolean;
}

export function BranchAreaManagers({ locale }: Props) {
  const isRTL = locale === "ar";
  const [rows, setRows] = useState<ManagerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const t = {
    title: isRTL ? "مديرو الفروع والمناطق" : "Branch & Area Managers",
    subtitle: isRTL
      ? "كل مدير والفروع التي يديرها."
      : "Each manager and the branches they oversee.",
    refresh: isRTL ? "تحديث" : "Refresh",
    search: isRTL ? "بحث بالاسم أو الفرع أو البريد..." : "Search by name, branch or email...",
    name: isRTL ? "الاسم" : "Name",
    title2: isRTL ? "الوظيفة" : "Title",
    type: isRTL ? "النوع" : "Type",
    branches: isRTL ? "الفروع" : "Branches",
    email: isRTL ? "البريد الإلكتروني" : "Email",
    branchManager: isRTL ? "مدير فرع" : "Branch Manager",
    areaManager: isRTL ? "مدير منطقة" : "Area Manager",
    empty: isRTL ? "لا يوجد مديرون مسجلون" : "No managers found",
    loadFailed: isRTL ? "تعذر التحميل" : "Failed to load",
    count: (n: number) =>
      isRTL ? `${n.toLocaleString("ar-EG")} مدير` : `${n.toLocaleString()} manager${n === 1 ? "" : "s"}`,
    inactive: isRTL ? "غير نشط" : "Inactive",
    exportPdf: isRTL ? "تصدير PDF" : "Export PDF",
    pdfTitle: isRTL ? "مديرو الفروع والمناطق" : "Branch & Area Managers",
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/managers-list", { credentials: "include" });
      const json = (await res.json()) as { managers?: ManagerRow[]; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.managers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.loadFailed);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [t.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const [exporting, setExporting] = useState(false);
  const allRowsRef = useRef<ManagerRow[]>([]);
  allRowsRef.current = rows;

  const handleExportPdf = useCallback(async () => {
    const allRows = allRowsRef.current;
    if (allRows.length === 0) return;
    setExporting(true);
    try {
      const [jspdfMod, autoTableMod, fontRes] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
        fetch("/fonts/Cairo-Regular.ttf"),
      ]);
      const JsPDF = (jspdfMod as any).jsPDF ?? (jspdfMod as any).default;
      const autoTable = (autoTableMod as any).default ?? (autoTableMod as any);

      if (!fontRes.ok) throw new Error("Font not available");
      const fontBuf = await fontRes.arrayBuffer();
      // Convert ArrayBuffer → base64 in chunks (avoid call-stack overflow).
      let binary = "";
      const bytes = new Uint8Array(fontBuf);
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(
          null,
          Array.from(bytes.subarray(i, i + CHUNK))
        );
      }
      const fontB64 = btoa(binary);

      const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      doc.addFileToVFS("Cairo-Regular.ttf", fontB64);
      doc.addFont("Cairo-Regular.ttf", "Cairo", "normal");
      doc.addFont("Cairo-Regular.ttf", "Cairo", "bold");

      const pageWidth = doc.internal.pageSize.getWidth();

      doc.setFont("Cairo", "bold");
      doc.setFontSize(16);
      doc.text(t.pdfTitle, isRTL ? pageWidth - 10 : 10, 14, {
        align: isRTL ? "right" : "left",
      });
      doc.setFont("Cairo", "normal");
      doc.setFontSize(10);
      doc.text(
        t.count(allRows.length),
        isRTL ? pageWidth - 10 : 10,
        20,
        { align: isRTL ? "right" : "left" }
      );

      const head = [[t.name, t.title2, t.type, t.branches, t.email]];
      const body = allRows.map((r) => [
        (r.full_name || "—") + (r.is_active ? "" : ` (${t.inactive})`),
        r.title ?? "—",
        r.type === "area_manager" ? t.areaManager : t.branchManager,
        r.branches.join(", ") || "—",
        r.email || "—",
      ]);

      autoTable(doc, {
        head,
        body,
        startY: 25,
        margin: { left: 8, right: 8 },
        styles: {
          font: "Cairo",
          fontStyle: "normal",
          fontSize: 9,
          cellPadding: 2.5,
          overflow: "linebreak",
          valign: "top",
          halign: isRTL ? "right" : "left",
        },
        headStyles: {
          font: "Cairo",
          fontStyle: "bold",
          fillColor: [243, 244, 246],
          textColor: [17, 24, 39],
          halign: isRTL ? "right" : "left",
        },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        columnStyles: {
          0: { cellWidth: 50, fontStyle: "bold" },
          1: { cellWidth: 30 },
          2: { cellWidth: 32 },
          3: { cellWidth: 110 },
          4: { cellWidth: 55 },
        },
        didParseCell: (data: any) => {
          if (data.section === "body" && data.column.index === 2) {
            const v = String(data.cell.raw ?? "");
            if (v === t.areaManager) {
              data.cell.styles.fillColor = [219, 234, 254];
              data.cell.styles.textColor = [30, 64, 175];
              data.cell.styles.fontStyle = "bold";
            } else if (v === t.branchManager) {
              data.cell.styles.fillColor = [209, 250, 229];
              data.cell.styles.textColor = [6, 95, 70];
              data.cell.styles.fontStyle = "bold";
            }
          }
        },
      });

      doc.save("branch-area-managers.pdf");
    } catch (e) {
      console.error(e);
      alert(isRTL ? "تعذر تصدير PDF" : "Failed to export PDF");
    } finally {
      setExporting(false);
    }
  }, [isRTL, t]);

  const filteredRef = useRef<ManagerRow[]>([]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      if (r.full_name.toLowerCase().includes(q)) return true;
      if (r.email.toLowerCase().includes(q)) return true;
      if (r.branches.some((b) => b.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [rows, query]);

  filteredRef.current = filtered;

  return (
    <Card className="border-border/80 shadow-md" dir={isRTL ? "rtl" : "ltr"}>
      <CardHeader className="space-y-3 border-b border-border/60 bg-gradient-to-b from-muted/40 to-transparent">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" aria-hidden />
            <CardTitle className="text-base font-semibold sm:text-lg">{t.title}</CardTitle>
            <Badge variant="secondary" className="ms-1 tabular-nums">
              {t.count(filtered.length)}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2"
              onClick={() => void handleExportPdf()}
              disabled={loading || exporting || rows.length === 0}
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              {t.exportPdf}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t.refresh}
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            placeholder={t.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 ps-9"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error && (
          <p className="m-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{isRTL ? "جارٍ التحميل..." : "Loading..."}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <Users className="h-8 w-8 opacity-60" aria-hidden />
            <p className="text-sm">{t.empty}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 border-b border-border bg-muted/95 px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.name}
                  </th>
                  <th className="sticky top-0 z-10 border-b border-border bg-muted/95 px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.title2}
                  </th>
                  <th className="sticky top-0 z-10 border-b border-border bg-muted/95 px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.type}
                  </th>
                  <th className="sticky top-0 z-10 border-b border-border bg-muted/95 px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.branches}
                  </th>
                  <th className="sticky top-0 z-10 border-b border-border bg-muted/95 px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.email}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtered.map((r) => (
                  <tr key={r.user_id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-foreground">{r.full_name || "—"}</span>
                        {!r.is_active && (
                          <Badge variant="outline" className="w-fit text-[10px] text-muted-foreground">
                            {t.inactive}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                      {r.title ?? "—"}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {r.type === "area_manager" ? (
                        <Badge className="bg-blue-500/15 text-blue-700 hover:bg-blue-500/20 dark:text-blue-200">
                          {t.areaManager}
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-200">
                          {t.branchManager}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {r.branches.map((b) => (
                          <span
                            key={b}
                            className="inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground"
                          >
                            {b}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground">
                      {r.email || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
