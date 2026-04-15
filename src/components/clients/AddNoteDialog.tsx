"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";

interface AddNoteDialogProps {
  client: { id: string; name: string };
  locale: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface NoteEntry {
  id: string;
  note: string;
  created_at: string;
  user_name: string;
  user_id?: string;
}

export function AddNoteDialog({ client, locale, onClose, onSuccess }: AddNoteDialogProps) {
  const { currentUser } = useStore();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [history, setHistory] = useState<NoteEntry[]>([]);
  const isRTL = locale === "ar";

  const groupedCount = useMemo(() => history.length, [history]);

  useEffect(() => {
    let active = true;
    const loadHistory = async () => {
      setLoadingHistory(true);
      try {
        const supabase = createClient() as any;
        const { data } = await supabase
          .from("activity_logs")
          .select("id, user_id, metadata, created_at")
          .eq("activity_type", "NOTE_ADDED")
          .eq("entity_id", client.id)
          .order("created_at", { ascending: false })
          .limit(100);
        if (!active) return;
        const outRaw: NoteEntry[] = (data ?? [])
          .map((r: any) => ({
            id: String(r.id),
            note: String(r?.metadata?.note ?? "").trim(),
            created_at: String(r.created_at),
            user_name: "—",
            user_id: r.user_id ? String(r.user_id) : undefined,
          }))
          .filter((r: NoteEntry) => r.note.length > 0);
        const userIds = Array.from(new Set(outRaw.map((x) => x.user_id).filter(Boolean))) as string[];
        let userNames = new Map<string, string>();
        if (userIds.length > 0) {
          const { data: userRows } = await supabase.from("users").select("id, full_name").in("id", userIds);
          userNames = new Map((userRows ?? []).map((u: any) => [String(u.id), String(u.full_name ?? "—")]));
        }
        const out = outRaw.map((entry) => ({
          ...entry,
          user_name: entry.user_id ? userNames.get(entry.user_id) ?? "—" : "—",
        }));
        setHistory(out);
      } finally {
        if (active) setLoadingHistory(false);
      }
    };
    void loadHistory();
    return () => {
      active = false;
    };
  }, [client.id]);

  const handleSave = async () => {
    if (!note.trim()) return;
    setSaving(true);

    try {
      const supabase = createClient() as any;
      const trimmed = note.trim();

      // Keep latest quick note on the client row for fast table rendering.
      await supabase
        .from("clients")
        .update({ notes: trimmed })
        .eq("id", client.id);

      await supabase.from("activity_logs").insert({
        user_id: currentUser!.id,
        activity_type: "NOTE_ADDED",
        entity_type: "client",
        entity_id: client.id,
        description: `Added note to ${client.name}`,
        metadata: { note: trimmed },
      });

      onSuccess();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md" dir={isRTL ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{isRTL ? "إضافة ملاحظة" : "Add Note"}</DialogTitle>
          <p className="text-sm text-muted-foreground">{client.name}</p>
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
              {isRTL ? `سجل الملاحظات السابق (${groupedCount})` : `Previous notes (${groupedCount})`}
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
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {isRTL ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={handleSave} disabled={saving || !note.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isRTL ? "حفظ" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
