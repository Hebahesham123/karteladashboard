"use client";

import { useCallback, useEffect, useState } from "react";
import { LogIn, LogOut, RefreshCw, ChevronLeft, ChevronRight, KeyRound, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AuthLogRow {
  id: number;
  user_id: string;
  email: string;
  event: "login" | "logout";
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

interface AuthLogsPanelProps {
  locale: string;
}

const PAGE_SIZE = 50;

function formatWhen(iso: string, isRTL: boolean): string {
  const d = new Date(iso);
  return d.toLocaleString(isRTL ? "ar-EG" : undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AuthLogsPanel({ locale }: AuthLogsPanelProps) {
  const isRTL = locale === "ar";
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuthLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<"all" | "login" | "logout">("all");
  const [emailQuery, setEmailQuery] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      if (eventFilter !== "all") params.set("event", eventFilter);
      if (emailQuery.trim()) params.set("email", emailQuery.trim());
      const res = await fetch(`/api/auth-events?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? (isRTL ? "تعذر تحميل السجل" : "Failed to load logs"));
        setRows([]);
        setTotal(0);
        return;
      }
      setRows((json?.events ?? []) as AuthLogRow[]);
      setTotal(Number(json?.total ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [offset, eventFilter, emailQuery, isRTL]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(total, offset + rows.length);
  const hasNext = offset + PAGE_SIZE < total;
  const hasPrev = offset > 0;

  const t = {
    button: isRTL ? "سجل الدخول والخروج" : "Login / Logout log",
    title: isRTL ? "سجل تسجيل الدخول والخروج" : "Login & logout log",
    subtitle: isRTL
      ? "كل تسجيل دخول أو خروج للمستخدمين."
      : "Every user login and logout event.",
    refresh: isRTL ? "تحديث" : "Refresh",
    all: isRTL ? "الكل" : "All",
    login: isRTL ? "دخول" : "Login",
    logout: isRTL ? "خروج" : "Logout",
    searchEmail: isRTL ? "بحث بالبريد الإلكتروني" : "Search by email",
    apply: isRTL ? "بحث" : "Search",
    empty: isRTL ? "لا توجد أحداث." : "No events yet.",
    time: isRTL ? "الوقت" : "Time",
    user: isRTL ? "المستخدم" : "User",
    event: isRTL ? "الحدث" : "Event",
    ip: isRTL ? "IP" : "IP",
    device: isRTL ? "الجهاز" : "Device",
    prev: isRTL ? "السابق" : "Prev",
    next: isRTL ? "التالي" : "Next",
    showing: isRTL ? "عرض" : "Showing",
    of: isRTL ? "من" : "of",
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setOffset(0);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <KeyRound className="h-4 w-4" />
          {t.button}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-4xl w-[min(96vw,64rem)] max-h-[85vh] gap-3 p-0 overflow-hidden flex flex-col"
        dir={isRTL ? "rtl" : "ltr"}
      >
        <DialogHeader className="px-5 pt-5 pb-2 border-b border-border">
          <DialogTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            {t.title}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">{t.subtitle}</p>
        </DialogHeader>

        <div className="px-5 pt-3 pb-2 flex flex-wrap items-center gap-2 border-b border-border">
          <Select
            value={eventFilter}
            onValueChange={(v) => {
              setEventFilter(v as "all" | "login" | "logout");
              setOffset(0);
            }}
          >
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.all}</SelectItem>
              <SelectItem value="login">{t.login}</SelectItem>
              <SelectItem value="logout">{t.logout}</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex-1 min-w-[10rem] relative">
            <Search className={`h-3.5 w-3.5 text-muted-foreground absolute top-1/2 -translate-y-1/2 ${isRTL ? "right-2.5" : "left-2.5"}`} />
            <Input
              value={pendingEmail}
              onChange={(e) => setPendingEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setEmailQuery(pendingEmail);
                  setOffset(0);
                }
              }}
              placeholder={t.searchEmail}
              className={`h-8 text-xs ${isRTL ? "pr-8" : "pl-8"}`}
            />
          </div>

          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => {
              setEmailQuery(pendingEmail);
              setOffset(0);
            }}
          >
            {t.apply}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs gap-1.5"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {t.refresh}
          </Button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-3">
          {error && (
            <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive mb-2">
              {error}
            </div>
          )}

          {!loading && rows.length === 0 && !error && (
            <div className="text-sm text-muted-foreground py-8 text-center">{t.empty}</div>
          )}

          {rows.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr className="text-muted-foreground">
                    <th className={`px-3 py-2 font-medium ${isRTL ? "text-right" : "text-left"}`}>{t.time}</th>
                    <th className={`px-3 py-2 font-medium ${isRTL ? "text-right" : "text-left"}`}>{t.user}</th>
                    <th className={`px-3 py-2 font-medium ${isRTL ? "text-right" : "text-left"}`}>{t.event}</th>
                    <th className={`px-3 py-2 font-medium ${isRTL ? "text-right" : "text-left"}`}>{t.ip}</th>
                    <th className={`px-3 py-2 font-medium ${isRTL ? "text-right" : "text-left"} hidden md:table-cell`}>{t.device}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{formatWhen(r.created_at, isRTL)}</td>
                      <td className="px-3 py-2 break-all">{r.email || "—"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                            r.event === "login"
                              ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
                              : "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
                          }`}
                        >
                          {r.event === "login" ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
                          {r.event === "login" ? t.login : t.logout}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.ip || "—"}</td>
                      <td className="px-3 py-2 hidden md:table-cell max-w-[24rem] truncate" title={r.user_agent ?? ""}>
                        {r.user_agent || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground tabular-nums">
            {t.showing} {pageStart}–{pageEnd} {t.of} {total}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              disabled={!hasPrev || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              {isRTL ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
              {t.prev}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              disabled={!hasNext || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {t.next}
              {isRTL ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
