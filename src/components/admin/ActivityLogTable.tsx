"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Upload, Edit3, MessageSquare, UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import type { ActivityLog, ActivityType } from "@/types/database";

interface ActivityLogTableProps {
  locale: string;
}

const activityIcons: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  EXCEL_UPLOAD: Upload,
  STATUS_CHANGE: Edit3,
  NOTE_ADDED: MessageSquare,
  CLIENT_CREATED: UserPlus,
  USER_CREATED: UserPlus,
  USER_UPDATED: Edit3,
};

const activityColors: Record<ActivityType, string> = {
  EXCEL_UPLOAD: "info",
  STATUS_CHANGE: "warning",
  NOTE_ADDED: "secondary",
  CLIENT_CREATED: "success",
  USER_CREATED: "success",
  USER_UPDATED: "warning",
};

interface LogWithUser extends ActivityLog {
  user_name: string;
}

export function ActivityLogTable({ locale }: ActivityLogTableProps) {
  const isRTL = locale === "ar";
  const [logs, setLogs] = useState<LogWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      const supabase = createClient();

      let query = supabase
        .from("activity_logs")
        .select("*, users(full_name)")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (filterType !== "all") {
        query = query.eq("activity_type", filterType);
      }

      const { data } = await query;
      setLogs(
        (data || []).map((log: any) => ({
          ...log,
          user_name: log.users?.full_name || "System",
        }))
      );
      setLoading(false);
    };

    fetchLogs();
  }, [filterType, page]);

  const activityTypes: ActivityType[] = [
    "EXCEL_UPLOAD",
    "STATUS_CHANGE",
    "NOTE_ADDED",
    "CLIENT_CREATED",
    "USER_CREATED",
    "USER_UPDATED",
  ];

  const activityLabels: Record<ActivityType, string> = {
    EXCEL_UPLOAD: isRTL ? "رفع Excel" : "Excel Upload",
    STATUS_CHANGE: isRTL ? "تغيير الحالة" : "Status Change",
    NOTE_ADDED: isRTL ? "إضافة ملاحظة" : "Note Added",
    CLIENT_CREATED: isRTL ? "إنشاء عميل" : "Client Created",
    USER_CREATED: isRTL ? "إنشاء مستخدم" : "User Created",
    USER_UPDATED: isRTL ? "تحديث مستخدم" : "User Updated",
  };

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex items-center gap-3">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-48 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isRTL ? "كل الأنشطة" : "All Activities"}</SelectItem>
            {activityTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {activityLabels[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-0">
              {Array(10).fill(0).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50">
                  <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
                  <div className="flex-1 space-y-1">
                    <div className="h-4 w-64 bg-muted rounded animate-pulse" />
                    <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {isRTL ? "لا توجد سجلات" : "No activity logs found"}
            </div>
          ) : (
            <div>
              {logs.map((log, i) => {
                const Icon = activityIcons[log.activity_type] || Activity;
                const color = activityColors[log.activity_type] || "secondary";
                const label = activityLabels[log.activity_type];

                return (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: isRTL ? 10 : -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="flex items-start gap-4 px-4 py-3 border-b border-border/50 hover:bg-muted/20"
                  >
                    <div className="mt-0.5 h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={color as any} className="text-xs shrink-0">
                          {label}
                        </Badge>
                        <span className="text-sm truncate">{log.description}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="font-medium">{log.user_name}</span>
                        <span>•</span>
                        <span>{formatDate(log.created_at)}</span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {isRTL ? `صفحة ${page + 1}` : `Page ${page + 1}`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-3 py-1 rounded-lg border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRTL ? "السابق" : "Previous"}
          </button>
          <button
            onClick={() => setPage(page + 1)}
            disabled={logs.length < PAGE_SIZE}
            className="px-3 py-1 rounded-lg border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRTL ? "التالي" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
