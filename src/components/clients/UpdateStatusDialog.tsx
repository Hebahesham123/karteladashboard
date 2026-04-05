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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";
import type { ClientStatus } from "@/types/database";

interface UpdateStatusDialogProps {
  client: { id: string; name: string; current_status: ClientStatus };
  locale: string;
  onClose: () => void;
  onSuccess: (newStatus?: string) => void;
}

const STATUSES: ClientStatus[] = [
  "NEW",
  "FOLLOW_UP_1",
  "FOLLOW_UP_2",
  "RECOVERED",
  "LOST",
  "CANCELLED",
];

const REASON_REQUIRED: ClientStatus[] = ["LOST", "CANCELLED"];

export function UpdateStatusDialog({
  client,
  locale,
  onClose,
  onSuccess,
}: UpdateStatusDialogProps) {
  const { currentUser } = useStore();
  const [newStatus, setNewStatus] = useState<ClientStatus>(client.current_status);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isRTL = locale === "ar";

  const requiresReason = REASON_REQUIRED.includes(newStatus);

  const statusLabels: Record<ClientStatus, string> = {
    NEW: isRTL ? "جديد" : "New",
    FOLLOW_UP_1: isRTL ? "متابعة 1" : "Follow Up 1",
    FOLLOW_UP_2: isRTL ? "متابعة 2" : "Follow Up 2",
    RECOVERED: isRTL ? "مستعاد" : "Recovered",
    LOST: isRTL ? "مفقود" : "Lost",
    CANCELLED: isRTL ? "ملغى" : "Cancelled",
  };

  const handleSave = async () => {
    if (requiresReason && !reason.trim()) {
      setError(isRTL ? "السبب مطلوب لهذه الحالة" : "Reason is required for this status");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const supabase = createClient() as any;

      // Update client status
      await supabase
        .from("clients")
        .update({
          current_status: newStatus,
          status_reason: reason || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", client.id);

      // Log status history
      await supabase.from("client_status_history").insert({
        client_id: client.id,
        changed_by: currentUser!.id,
        old_status: client.current_status,
        new_status: newStatus,
        reason: reason || null,
      });

      // Log activity
      await supabase.from("activity_logs").insert({
        user_id: currentUser!.id,
        activity_type: "STATUS_CHANGE",
        entity_type: "client",
        entity_id: client.id,
        description: `Changed status of ${client.name} from ${client.current_status} to ${newStatus}`,
        metadata: {
          old_status: client.current_status,
          new_status: newStatus,
          reason,
        },
      });

      onSuccess(newStatus);
    } catch {
      setError(isRTL ? "حدث خطأ أثناء الحفظ" : "An error occurred while saving");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md" dir={isRTL ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>
            {isRTL ? "تحديث الحالة" : "Update Status"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{client.name}</p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {isRTL ? "الحالة الجديدة" : "New Status"}
            </label>
            <Select
              value={newStatus}
              onValueChange={(v) => setNewStatus(v as ClientStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {statusLabels[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {requiresReason && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {isRTL ? "السبب (مطلوب)" : "Reason (Required)"}
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={isRTL ? "اذكر السبب..." : "Enter reason..."}
                className="w-full min-h-[80px] rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {isRTL ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {isRTL ? "حفظ" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
