"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Activity, Upload, Edit3, MessageSquare, UserPlus,
  Search, RefreshCw, ArrowRight, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { ActivityType } from "@/types/database";

interface ActivityLogTableProps {
  locale: string;
}

interface LogRow {
  id: string;
  activity_type: ActivityType;
  entity_type: string | null;
  description: string;
  metadata: Record<string, any> | null;
  created_at: string;
  user_name: string;
  user_role: string;
}

const TYPE_ICON: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  EXCEL_UPLOAD:    Upload,
  STATUS_CHANGE:   Edit3,
  NOTE_ADDED:      MessageSquare,
  CLIENT_CREATED:  UserPlus,
  USER_CREATED:    UserPlus,
  USER_UPDATED:    Edit3,
};

const TYPE_COLOR: Record<ActivityType, string> = {
  EXCEL_UPLOAD:    "bg-blue-100   text-blue-700   border-blue-200   dark:bg-blue-950   dark:text-blue-300   dark:border-blue-800",
  STATUS_CHANGE:   "bg-amber-100  text-amber-700  border-amber-200  dark:bg-amber-950  dark:text-amber-300  dark:border-amber-800",
  NOTE_ADDED:      "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800",
  CLIENT_CREATED:  "bg-green-100  text-green-700  border-green-200  dark:bg-green-950  dark:text-green-300  dark:border-green-800",
  USER_CREATED:    "bg-green-100  text-green-700  border-green-200  dark:bg-green-950  dark:text-green-300  dark:border-green-800",
  USER_UPDATED:    "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800",
};

const STATUS_LABELS: Record<string, string> = {
  NEW: "جديد", FOLLOW_UP_1: "متابعة 1", FOLLOW_UP_2: "متابعة 2",
  RECOVERED: "مستعاد", LOST: "مفقود", CANCELLED: "ملغى",
};

function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return "الآن";
  if (diff < 3600)  return `منذ ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعة`;
  if (diff < 604800) return `منذ ${Math.floor(diff / 86400)} يوم`;
  return new Date(iso).toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" });
}

function formatRelativeEn(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function MetaDetail({ log, isRTL }: { log: LogRow; isRTL: boolean }) {
  const m = log.metadata;
  if (!m) return null;

  if (log.activity_type === "STATUS_CHANGE") {
    const oldL = (isRTL ? STATUS_LABELS[m.old_status] : m.old_status) ?? m.old_status;
    const newL = (isRTL ? STATUS_LABELS[m.new_status] : m.new_status) ?? m.new_status;
    return (
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-muted text-muted-foreground">{oldL}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-primary/10 text-primary font-semibold">{newL}</span>
        {m.reason && (
          <span className="text-xs text-muted-foreground italic">
            — {isRTL ? "السبب:" : "Reason:"} {m.reason}
          </span>
        )}
      </div>
    );
  }

  if (log.activity_type === "NOTE_ADDED" && m.note) {
    return (
      <div className="mt-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-foreground leading-relaxed max-w-xl">
        {m.note}
      </div>
    );
  }

  if (log.activity_type === "EXCEL_UPLOAD" && m.rows) {
    return (
      <span className="mt-1 text-xs text-muted-foreground">
        {isRTL ? `${m.rows} صف — ${m.file ?? ""}` : `${m.rows} rows — ${m.file ?? ""}`}
      </span>
    );
  }

  return null;
}

const PAGE_SIZE = 30;

export function ActivityLogTable({ locale }: ActivityLogTableProps) {
  const isRTL = locale === "ar";
  const [logs, setLogs]           = useState<LogRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch]       = useState("");
  const [page, setPage]           = useState(0);
  const [total, setTotal]         = useState(0);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    let q = supabase
      .from("activity_logs")
      .select("id,activity_type,entity_type,description,metadata,created_at,users(full_name,role)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filterType !== "all") q = q.eq("activity_type", filterType);
    if (search.trim())        q = q.ilike("description", `%${search.trim()}%`);

    const { data, count } = await q;
    setTotal(count ?? 0);
    setLogs(
      (data ?? []).map((row: any) => ({
        ...row,
        user_name: row.users?.full_name ?? (isRTL ? "النظام" : "System"),
        user_role: row.users?.role ?? "",
      }))
    );
    setLoading(false);
  }, [filterType, search, page, isRTL]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Auto-refresh every 30 s
  useEffect(() => {
    const id = setInterval(fetchLogs, 30_000);
    return () => clearInterval(id);
  }, [fetchLogs]);

  const activityTypes: ActivityType[] = ["EXCEL_UPLOAD","STATUS_CHANGE","NOTE_ADDED","CLIENT_CREATED","USER_CREATED","USER_UPDATED"];
  const typeLabels: Record<ActivityType, string> = {
    EXCEL_UPLOAD:   isRTL ? "رفع Excel"       : "Excel Upload",
    STATUS_CHANGE:  isRTL ? "تغيير الحالة"    : "Status Change",
    NOTE_ADDED:     isRTL ? "إضافة ملاحظة"   : "Note Added",
    CLIENT_CREATED: isRTL ? "إنشاء عميل"     : "Client Created",
    USER_CREATED:   isRTL ? "إنشاء مستخدم"   : "User Created",
    USER_UPDATED:   isRTL ? "تحديث مستخدم"   : "User Updated",
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const from = page * PAGE_SIZE + 1;
  const to   = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Activity className="h-4 w-4 text-muted-foreground shrink-0" />

        <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(0); }}>
          <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isRTL ? "كل الأنشطة" : "All Activities"}</SelectItem>
            {activityTypes.map((t) => (
              <SelectItem key={t} value={t}>{typeLabels[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={isRTL ? "بحث في السجلات..." : "Search logs..."}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={fetchLogs} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {isRTL ? "تحديث" : "Refresh"}
        </Button>

        {total > 0 && (
          <span className="text-xs text-muted-foreground ms-auto">
            {isRTL ? `${from}–${to} من ${total}` : `${from}–${to} of ${total}`}
          </span>
        )}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div>
              {Array(10).fill(0).map((_, i) => (
                <div key={i} className="flex items-start gap-4 px-5 py-4 border-b border-border/50">
                  <div className="h-9 w-9 rounded-full bg-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 w-72 bg-muted rounded animate-pulse" />
                    <div className="h-3 w-40 bg-muted rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              {isRTL ? "لا توجد سجلات" : "No activity logs found"}
            </div>
          ) : (
            <div>
              {logs.map((log, i) => {
                const Icon  = TYPE_ICON[log.activity_type] ?? Activity;
                const color = TYPE_COLOR[log.activity_type] ?? "";
                const label = typeLabels[log.activity_type];
                const time  = new Date(log.created_at);
                const rel   = isRTL ? formatRelative(log.created_at) : formatRelativeEn(log.created_at);
                const abs   = time.toLocaleString(isRTL ? "ar-EG" : "en-GB", {
                  day: "2-digit", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                });

                return (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.015, 0.2) }}
                    className={`flex items-start gap-4 px-5 py-4 border-b border-border/50 hover:bg-muted/20 transition-colors ${i % 2 === 1 ? "bg-muted/5" : ""}`}
                  >
                    {/* Icon */}
                    <div className={`mt-0.5 h-9 w-9 rounded-full flex items-center justify-center shrink-0 border ${color}`}>
                      <Icon className="h-4 w-4" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${color}`}>
                          {label}
                        </span>
                        <span className="text-sm font-medium leading-snug">{log.description}</span>
                      </div>

                      {/* Metadata detail */}
                      <MetaDetail log={log} isRTL={isRTL} />

                      {/* Footer: user + time */}
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1 font-medium text-foreground/70">
                          {log.user_name}
                          {log.user_role && (
                            <span className="font-normal opacity-60">({log.user_role})</span>
                          )}
                        </span>
                        <span>·</span>
                        <span title={abs}>{rel}</span>
                        <span className="opacity-50 hidden sm:inline">— {abs}</span>
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{isRTL ? `صفحة ${page + 1} من ${totalPages}` : `Page ${page + 1} of ${totalPages}`}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2">{page + 1}</span>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
