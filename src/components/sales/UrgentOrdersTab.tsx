"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AddNoteDialog } from "@/components/clients/AddNoteDialog";
import { ClientStatusSelect } from "@/components/clients/ClientStatusSelect";
import type { ClientStatus } from "@/types/database";

type Row = {
  id: string;
  client_id: string;
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
  urgent_note: string | null;
  assigned_at: string | null;
};

export function UrgentOrdersTab({ locale }: { locale: string }) {
  const isRTL = locale === "ar";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/urgent-orders/my", { credentials: "include" });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Failed");
      setRows([]);
    } else {
      setRows(json.rows ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      `${r.client_name} ${r.partner_id} ${r.product_name} ${r.invoice_ref} ${r.category ?? ""} ${r.pricelist ?? ""} ${r.urgent_note ?? ""}`
        .toLowerCase()
        .includes(needle)
    );
  }, [rows, q]);

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-lg font-semibold">{isRTL ? "الطلبات العاجلة المعيّنة لي" : "My Assigned Urgent Orders"}</h3>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isRTL ? "ابحث..." : "Search..."}
            className="w-full sm:w-80"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="overflow-x-auto border rounded-lg">
          <div className="md:hidden p-2 space-y-2">
            {loading ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin inline me-2" />
                {isRTL ? "جارٍ التحميل..." : "Loading..."}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                {isRTL ? "لا توجد طلبات عاجلة" : "No urgent orders assigned"}
              </div>
            ) : (
              filtered.map((r) => (
                <div key={r.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{r.client_name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{r.partner_id}</p>
                    </div>
                    <p className="text-[11px] font-mono text-muted-foreground text-end">{r.invoice_ref || "—"}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">{isRTL ? "المنتج" : "Product"}</p>
                      <p className="font-medium truncate">{r.product_name}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{isRTL ? "الحالة" : "Status"}</p>
                      <ClientStatusSelect
                        compact
                        clientId={r.client_id}
                        clientName={r.client_name}
                        currentStatus={r.current_status as ClientStatus}
                        locale={locale}
                        onUpdated={(newStatus) => {
                          setRows((prev) =>
                            prev.map((x) =>
                              x.client_id === r.client_id ? { ...x, current_status: newStatus } : x
                            )
                          );
                        }}
                      />
                    </div>
                  </div>

                  {r.urgent_note && (
                    <div className="text-xs rounded-lg border border-border bg-muted/20 px-2 py-1.5">
                      <span className="text-muted-foreground">{isRTL ? "تعليمات الأدمن:" : "Admin note:"} </span>
                      <span>{r.urgent_note}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">{r.notes ?? "—"}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0"
                      onClick={() => setSelectedClient({ id: r.client_id, name: r.client_name })}
                    >
                      {isRTL ? "ملاحظة" : "Note"}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <table className="hidden md:table w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="p-2 text-start">{isRTL ? "فاتوره" : "Invoice"}</th>
                <th className="p-2 text-start">{isRTL ? "العميل" : "Client"}</th>
                <th className="p-2 text-start">{isRTL ? "المنتج" : "Product"}</th>
                <th className="p-2 text-start">{isRTL ? "الحالة" : "Status"}</th>
                <th className="p-2 text-start">{isRTL ? "ملاحظات العميل" : "Client notes"}</th>
                <th className="p-2 text-start">{isRTL ? "تعليمات الأدمن" : "Admin note"}</th>
                <th className="p-2 text-start">{isRTL ? "إجراءات" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline me-2" />{isRTL ? "جارٍ التحميل..." : "Loading..."}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">{isRTL ? "لا توجد طلبات عاجلة" : "No urgent orders assigned"}</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 font-mono text-xs">{r.invoice_ref || "—"}</td>
                    <td className="p-2">{r.client_name} <span className="text-xs text-muted-foreground">({r.partner_id})</span></td>
                    <td className="p-2">{r.product_name}</td>
                    <td className="p-2">
                      <ClientStatusSelect
                        compact
                        clientId={r.client_id}
                        clientName={r.client_name}
                        currentStatus={r.current_status as ClientStatus}
                        locale={locale}
                        onUpdated={(newStatus) => {
                          setRows((prev) =>
                            prev.map((x) =>
                              x.client_id === r.client_id ? { ...x, current_status: newStatus } : x
                            )
                          );
                        }}
                      />
                    </td>
                    <td className="p-2 max-w-[220px] truncate" title={r.notes ?? ""}>{r.notes ?? "—"}</td>
                    <td className="p-2 max-w-[240px] truncate" title={r.urgent_note ?? ""}>{r.urgent_note ?? "—"}</td>
                    <td className="p-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => setSelectedClient({ id: r.client_id, name: r.client_name })}
                      >
                        {isRTL ? "ملاحظة" : "Note"}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {selectedClient && (
          <AddNoteDialog
            client={selectedClient}
            locale={locale}
            onClose={() => setSelectedClient(null)}
            onSuccess={() => {
              setSelectedClient(null);
              void load();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
