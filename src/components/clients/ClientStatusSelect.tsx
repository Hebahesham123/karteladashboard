"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { ClientStatus } from "@/types/database";

const STATUSES: ClientStatus[] = [
  "NEW",
  "FOLLOW_UP_1",
  "FOLLOW_UP_2",
  "RECOVERED",
  "LOST",
  "CANCELLED",
];

const REASON_REQUIRED: ClientStatus[] = ["LOST", "CANCELLED"];

function labels(isRTL: boolean): Record<ClientStatus, string> {
  return {
    NEW: isRTL ? "جديد" : "New",
    FOLLOW_UP_1: isRTL ? "متابعة 1" : "Follow Up 1",
    FOLLOW_UP_2: isRTL ? "متابعة 2" : "Follow Up 2",
    RECOVERED: isRTL ? "مستعاد" : "Recovered",
    LOST: isRTL ? "مفقود" : "Lost",
    CANCELLED: isRTL ? "ملغى" : "Cancelled",
  };
}

interface ClientStatusSelectProps {
  clientId: string;
  clientName: string;
  currentStatus: ClientStatus;
  locale: string;
  compact?: boolean;
  onUpdated: (newStatus: ClientStatus) => void;
}

export function ClientStatusSelect({
  clientId,
  clientName,
  currentStatus,
  locale,
  compact = false,
  onUpdated,
}: ClientStatusSelectProps) {
  const { currentUser } = useStore();
  const isRTL = locale === "ar";
  const statusLabels = labels(isRTL);

  const [selectValue, setSelectValue] = useState<ClientStatus>(currentStatus);
  const [pendingReason, setPendingReason] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pendingReason) setSelectValue(currentStatus);
  }, [currentStatus, pendingReason]);

  const persist = async (newStatus: ClientStatus, reasonText: string) => {
    if (!currentUser?.id) {
      setError(isRTL ? "غير مسجل الدخول" : "Not signed in");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const supabase = createClient() as any;
      const old = currentStatus;

      await supabase
        .from("clients")
        .update({
          current_status: newStatus,
          status_reason: reasonText.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", clientId);

      await supabase.from("client_status_history").insert({
        client_id: clientId,
        changed_by: currentUser.id,
        old_status: old,
        new_status: newStatus,
        reason: reasonText.trim() || null,
      });

      await supabase.from("activity_logs").insert({
        user_id: currentUser.id,
        activity_type: "STATUS_CHANGE",
        entity_type: "client",
        entity_id: clientId,
        description: `Changed status of ${clientName} from ${old} to ${newStatus}`,
        metadata: { old_status: old, new_status: newStatus, reason: reasonText },
      });

      setPendingReason(false);
      setReason("");
      onUpdated(newStatus);
    } catch {
      setError(isRTL ? "فشل الحفظ" : "Save failed");
      setSelectValue(currentStatus);
    } finally {
      setSaving(false);
    }
  };

  const onSelectChange = (v: string) => {
    const next = v as ClientStatus;
    setError("");
    if (next === currentStatus) {
      setPendingReason(false);
      setReason("");
      setSelectValue(currentStatus);
      return;
    }

    if (REASON_REQUIRED.includes(next)) {
      setSelectValue(next);
      setPendingReason(true);
      setReason("");
      return;
    }

    setSelectValue(next);
    setPendingReason(false);
    setReason("");
    void persist(next, "");
  };

  const applyReason = () => {
    if (!reason.trim()) {
      setError(isRTL ? "السبب مطلوب" : "Reason is required");
      return;
    }
    void persist(selectValue, reason);
  };

  const cancelReason = () => {
    setPendingReason(false);
    setReason("");
    setError("");
    setSelectValue(currentStatus);
  };

  return (
    <div className={cn("flex flex-col items-start", !compact && "gap-0")} dir={isRTL ? "rtl" : "ltr"}>
      <Select
        value={selectValue}
        onValueChange={onSelectChange}
        disabled={saving || !currentUser}
      >
        <SelectTrigger
          className={
            compact
              ? "h-7 min-w-[7.5rem] max-w-[10rem] text-xs"
              : "h-8 min-w-[9rem] max-w-[12rem] text-xs"
          }
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s} className="text-xs">
              {statusLabels[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {pendingReason && (
        <div className="mt-1.5 space-y-1.5 w-full min-w-[12rem] max-w-[220px]">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={isRTL ? "السبب..." : "Reason..."}
            className="w-full min-h-[56px] rounded-md border border-input bg-background px-2 py-1.5 text-xs resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            disabled={saving}
          />
          <div className="flex gap-1 justify-end">
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelReason} disabled={saving}>
              {isRTL ? "إلغاء" : "Cancel"}
            </Button>
            <Button type="button" size="sm" className="h-7 text-xs gap-1" onClick={applyReason} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {isRTL ? "تطبيق" : "Apply"}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-[10px] text-destructive mt-0.5">{error}</p>}
    </div>
  );
}
