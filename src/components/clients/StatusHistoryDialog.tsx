"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { formatDate, getStatusColor } from "@/lib/utils";
import type { ClientStatus } from "@/types/database";

interface StatusHistoryDialogProps {
  clientId: string;
  clientName: string;
  locale: string;
  onClose: () => void;
}

interface HistoryEntry {
  id: string;
  old_status: ClientStatus | null;
  new_status: ClientStatus;
  reason: string | null;
  note: string | null;
  created_at: string;
  user_name: string;
}

export function StatusHistoryDialog({
  clientId,
  clientName,
  locale,
  onClose,
}: StatusHistoryDialogProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const isRTL = locale === "ar";

  const statusLabels: Record<ClientStatus, string> = {
    NEW: isRTL ? "جديد" : "New",
    FOLLOW_UP_1: isRTL ? "متابعة 1" : "Follow Up 1",
    FOLLOW_UP_2: isRTL ? "متابعة 2" : "Follow Up 2",
    RECOVERED: isRTL ? "مستعاد" : "Recovered",
    LOST: isRTL ? "مفقود" : "Lost",
    CANCELLED: isRTL ? "ملغى" : "Cancelled",
  };

  useEffect(() => {
    const fetch = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("client_status_history")
        .select("*, users(full_name)")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });

      setHistory(
        (data || []).map((h: any) => ({
          ...h,
          user_name: h.users?.full_name || "Unknown",
        }))
      );
      setLoading(false);
    };
    fetch();
  }, [clientId]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg" dir={isRTL ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>
            {isRTL ? "سجل الحالات" : "Status History"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{clientName}</p>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto space-y-3 scrollbar-thin">
          {loading ? (
            <div className="space-y-3">
              {Array(3).fill(0).map((_, i) => (
                <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {isRTL ? "لا يوجد سجل" : "No history found"}
            </p>
          ) : (
            history.map((entry) => (
              <div key={entry.id} className="p-3 rounded-xl border border-border bg-muted/20">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    {entry.old_status && (
                      <>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(entry.old_status)}`}
                        >
                          {statusLabels[entry.old_status]}
                        </span>
                        <span className="text-muted-foreground text-xs">→</span>
                      </>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(entry.new_status)}`}
                    >
                      {statusLabels[entry.new_status]}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium">{entry.user_name}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</p>
                  </div>
                </div>
                {entry.reason && (
                  <p className="mt-2 text-xs text-muted-foreground border-t border-border pt-2">
                    {entry.reason}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
