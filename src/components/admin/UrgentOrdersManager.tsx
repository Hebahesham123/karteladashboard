"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Salesperson = { id: string; code: string; name: string };
type Row = {
  id: string;
  invoice_ref: string;
  category: string | null;
  pricelist: string | null;
  month: number;
  year: number;
  quantity: number;
  invoice_total: number;
  client_name: string;
  partner_id: string;
  product_name: string;
  current_status: string;
  notes: string | null;
  assigned: boolean;
  assigned_note: string | null;
};

export function UrgentOrdersManager({
  locale,
  initialSalespersonId,
  showSalespersonCards = true,
}: {
  locale: string;
  initialSalespersonId?: string;
  showSalespersonCards?: boolean;
}) {
  const isRTL = locale === "ar";
  const router = useRouter();
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  const [salespersonId, setSalespersonId] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("3");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assignNote, setAssignNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (targetSalespersonId?: string) => {
    const sid = targetSalespersonId ?? salespersonId;
    if (!sid) return;
    setLoading(true);
    setError(null);
    setRows([]);
    const res = await fetch(`/api/urgent-orders/admin?salespersonId=${sid}&month=${month}&year=${year}`, {
      credentials: "include",
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Failed");
      setRows([]);
      setLoading(false);
      return;
    }
    setSalespersons(json.salespersons ?? []);
    setRows(json.rows ?? []);
    setLoading(false);
  }, [salespersonId, month, year]);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      const res = await fetch(`/api/urgent-orders/admin?salespersonId=__init__&month=${month}&year=${year}`, {
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed");
        setLoading(false);
        return;
      }
      const sps = (json.salespersons ?? []) as Salesperson[];
      setSalespersons(sps);
      const preferred =
        (initialSalespersonId && sps.some((s) => s.id === initialSalespersonId) ? initialSalespersonId : "") ||
        sps[0]?.id ||
        "";
      setSalespersonId(preferred);
      if (preferred) await load(preferred);
      else {
        setRows([]);
        setLoading(false);
      }
    };
    void bootstrap();
  }, [month, year, load, initialSalespersonId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      `${r.client_name} ${r.partner_id} ${r.product_name} ${r.invoice_ref} ${r.category ?? ""} ${r.pricelist ?? ""}`
        .toLowerCase()
        .includes(needle)
    );
  }, [rows, q]);

  const toggleAssign = async (row: Row) => {
    if (!salespersonId) return;
    setBusyId(row.id);
    const res = await fetch("/api/urgent-orders/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        orderId: row.id,
        salespersonId,
        assigned: !row.assigned,
        note: assignNote[row.id] ?? row.assigned_note ?? "",
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Failed");
      setBusyId(null);
      return;
    }
    setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, assigned: !x.assigned, assigned_note: assignNote[row.id] ?? x.assigned_note } : x)));
    setBusyId(null);
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        {showSalespersonCards && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{isRTL ? "اختر المندوب" : "Choose salesperson"}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {salespersons.map((s) => {
                const active = salespersonId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => router.push(`/urgent-orders/${s.id}`)}
                    className={`rounded-lg border px-3 py-2 text-start transition ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card hover:bg-muted/40"
                    }`}
                  >
                    <p className="text-sm font-semibold truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{s.code}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <Input value={month} onChange={(e) => setMonth(e.target.value)} placeholder={isRTL ? "شهر" : "Month"} />
          <Input value={year} onChange={(e) => setYear(e.target.value)} placeholder={isRTL ? "سنة" : "Year"} />
          <Button variant="outline" onClick={() => void load()} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {isRTL ? "تحديث" : "Refresh"}
          </Button>
        </div>

        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isRTL ? "ابحث داخل الطلبات..." : "Search orders..."} />
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="p-2 text-start">{isRTL ? "عاجل" : "Urgent"}</th>
                <th className="p-2 text-start">{isRTL ? "فاتوره" : "Invoice"}</th>
                <th className="p-2 text-start">{isRTL ? "العميل" : "Client"}</th>
                <th className="p-2 text-start">{isRTL ? "المنتج" : "Product"}</th>
                <th className="p-2 text-start">{isRTL ? "الحالة" : "Status"}</th>
                <th className="p-2 text-start">{isRTL ? "ملاحظات المندوب" : "Sales notes"}</th>
                <th className="p-2 text-start">{isRTL ? "ملاحظة التعيين" : "Assign note"}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">
                    <Button size="sm" variant={r.assigned ? "default" : "outline"} onClick={() => void toggleAssign(r)} disabled={busyId === r.id} className="h-7 gap-1">
                      {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : r.assigned ? <Check className="h-3.5 w-3.5" /> : null}
                      {r.assigned ? (isRTL ? "مُعيّن" : "Assigned") : (isRTL ? "تعيين" : "Assign")}
                    </Button>
                  </td>
                  <td className="p-2 font-mono text-xs">{r.invoice_ref || "—"}</td>
                  <td className="p-2">{r.client_name} <span className="text-xs text-muted-foreground">({r.partner_id})</span></td>
                  <td className="p-2">{r.product_name}</td>
                  <td className="p-2">{r.current_status}</td>
                  <td className="p-2 max-w-[220px] truncate" title={r.notes ?? ""}>{r.notes ?? "—"}</td>
                  <td className="p-2">
                    <Input
                      value={assignNote[r.id] ?? r.assigned_note ?? ""}
                      onChange={(e) => setAssignNote((p) => ({ ...p, [r.id]: e.target.value }))}
                      placeholder={isRTL ? "اكتب ملاحظة" : "Write note"}
                      className="h-8 min-w-[180px]"
                    />
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td className="p-4 text-muted-foreground text-center" colSpan={7}>{isRTL ? "لا توجد طلبات" : "No orders found"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
