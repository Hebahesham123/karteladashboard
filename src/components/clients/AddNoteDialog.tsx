"use client";

import { useState } from "react";
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

export function AddNoteDialog({ client, locale, onClose, onSuccess }: AddNoteDialogProps) {
  const { currentUser } = useStore();
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const isRTL = locale === "ar";

  const handleSave = async () => {
    if (!note.trim()) return;
    setLoading(true);

    try {
      const supabase = createClient() as any;

      await supabase
        .from("clients")
        .update({ notes: note })
        .eq("id", client.id);

      await supabase.from("activity_logs").insert({
        user_id: currentUser!.id,
        activity_type: "NOTE_ADDED",
        entity_type: "client",
        entity_id: client.id,
        description: `Added note to ${client.name}`,
        metadata: { note },
      });

      onSuccess();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md" dir={isRTL ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{isRTL ? "إضافة ملاحظة" : "Add Note"}</DialogTitle>
          <p className="text-sm text-muted-foreground">{client.name}</p>
        </DialogHeader>

        <div className="py-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isRTL ? "اكتب ملاحظتك هنا..." : "Write your note here..."}
            className="w-full min-h-[120px] rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            autoFocus
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {isRTL ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={handleSave} disabled={loading || !note.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isRTL ? "حفظ" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
