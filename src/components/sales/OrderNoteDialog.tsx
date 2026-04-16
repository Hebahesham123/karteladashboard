"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type NoteEntry = {
  id: string;
  note: string;
  created_at: string;
  user_name: string;
};

export function OrderNoteDialog({
  locale,
  order,
  endpointBase = "/api/urgent-orders/my/notes",
  onClose,
  onSuccess,
}: {
  locale: string;
  order: { id: string; clientName: string };
  endpointBase?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isRTL = locale === "ar";
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [history, setHistory] = useState<NoteEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoadingHistory(true);
      setError(null);
      try {
        const res = await fetch(`${endpointBase}?orderId=${encodeURIComponent(order.id)}`, {
          credentials: "include",
        });
        const json = await res.json();
        if (!active) return;
        if (!res.ok) {
          setError(json.error || "Failed");
          setHistory([]);
          return;
        }
        setHistory((json.history ?? []) as NoteEntry[]);
      } catch {
        if (active) {
          setError("Failed");
          setHistory([]);
        }
      } finally {
        if (active) setLoadingHistory(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [order.id, endpointBase]);

  const save = async () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(endpointBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          orderId: order.id,
          note: trimmed,
          clientName: order.clientName,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed");
        return;
      }
      onSuccess();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md" dir={isRTL ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{isRTL ? "إضافة ملاحظة للطلب" : "Add Order Note"}</DialogTitle>
          <p className="text-sm text-muted-foreground">{order.clientName}</p>
        </DialogHeader>

        <div className="py-1 space-y-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isRTL ? "اكتب ملاحظتك هنا..." : "Write your note here..."}
            className="w-full min-h-[120px] rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            autoFocus
          />

          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {isRTL ? `سجل الملاحظات السابق (${history.length})` : `Previous notes (${history.length})`}
            </p>
            {loadingHistory ? (
              <p className="text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin inline me-1" />
                {isRTL ? "جارٍ تحميل السجل..." : "Loading history..."}
              </p>
            ) : history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {isRTL ? "لا توجد ملاحظات سابقة" : "No previous notes"}
              </p>
            ) : (
              <div className="space-y-2 max-h-44 overflow-y-auto pe-1">
                {history.map((entry) => (
                  <div key={entry.id} className="rounded-md border border-border bg-background px-2.5 py-2">
                    <p className="text-sm whitespace-pre-wrap break-words">{entry.note}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {entry.user_name} · {new Date(entry.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {isRTL ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={save} disabled={saving || !note.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isRTL ? "حفظ" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
