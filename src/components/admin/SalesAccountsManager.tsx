"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  UserPlus, CheckCircle, XCircle, Loader2, Users,
  Key, Mail, Link2, AlertCircle, RefreshCw, Unlink, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";

interface Props { locale: string; }

interface SpRow {
  id: string;
  code: string;
  name: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
}

interface UserOption { id: string; email: string; full_name: string; }

export function SalesAccountsManager({ locale }: Props) {
  const isRTL = locale === "ar";

  const [salespersons, setSalespersons] = useState<SpRow[]>([]);
  const [users, setUsers]               = useState<UserOption[]>([]);
  const [loading, setLoading]           = useState(true);
  const [creating, setCreating]         = useState(false);
  const [createResult, setCreateResult] = useState<{ created: number; linked: number; failed: number } | null>(null);
  const [resetting, setResetting]       = useState(false);
  const [resetResult, setResetResult]   = useState<{ reset: number; failed: number } | null>(null);
  const [linkingId, setLinkingId]       = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient() as any;

    const [{ data: sps }, { data: usrs }] = await Promise.all([
      supabase.from("salespersons").select("id,code,name,user_id").order("name"),
      supabase.from("users").select("id,email,full_name").eq("role", "sales").order("full_name"),
    ]);

    const userMap: Record<string, UserOption> = {};
    (usrs ?? []).forEach((u: UserOption) => { userMap[u.id] = u; });
    setUsers(usrs ?? []);

    setSalespersons(
      (sps ?? []).map((sp: any) => ({
        ...sp,
        user_email: sp.user_id ? (userMap[sp.user_id]?.email ?? null) : null,
        user_name:  sp.user_id ? (userMap[sp.user_id]?.full_name ?? null) : null,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreateAll = async () => {
    setCreating(true);
    setCreateResult(null);
    try {
      const res = await fetch("/api/admin/create-accounts", { method: "POST" });
      const data = await res.json();
      setCreateResult({ created: data.created, linked: data.linked ?? 0, failed: data.failed });
      await load();
    } catch {
      setCreateResult({ created: 0, linked: 0, failed: 1 });
    }
    setCreating(false);
  };

  const handleResetPasswords = async () => {
    if (!confirm(isRTL ? "هل تريد إعادة تعيين كلمة مرور جميع المندوبين إلى sales123؟" : "Reset ALL salesperson passwords to sales123?")) return;
    setResetting(true);
    setResetResult(null);
    try {
      const res = await fetch("/api/admin/reset-passwords", { method: "POST" });
      const data = await res.json();
      setResetResult({ reset: data.reset, failed: data.failed });
    } catch {
      setResetResult({ reset: 0, failed: 1 });
    }
    setResetting(false);
  };

  const handleLink = async (spId: string) => {
    const userId = selectedUser[spId];
    if (!userId) return;
    setLinkingId(spId);
    const supabase = createClient() as any;
    await supabase.from("salespersons").update({ user_id: userId }).eq("id", spId);
    await load();
    setLinkingId(null);
  };

  const handleUnlink = async (spId: string) => {
    setLinkingId(spId);
    const supabase = createClient() as any;
    await supabase.from("salespersons").update({ user_id: null }).eq("id", spId);
    await load();
    setLinkingId(null);
  };

  const linked   = salespersons.filter((s) => s.user_id);
  const unlinked = salespersons.filter((s) => !s.user_id);

  const t = {
    title:    isRTL ? "حسابات المندوبين" : "Salesperson Accounts",
    subtitle: isRTL
      ? "اضغط الزر مرة واحدة — سيتم إنشاء الحسابات وربطها تلقائياً لجميع المندوبين"
      : "Press once — accounts are created & linked automatically for all salespersons",
    createBtn:  isRTL ? "إنشاء وربط الحسابات تلقائياً" : "Auto-create & Link All Accounts",
    creating:   isRTL ? "جارٍ الإنشاء والربط..." : "Creating & linking...",
    refresh:    isRTL ? "تحديث" : "Refresh",
    linked:     isRTL ? "مرتبط" : "Linked",
    unlinked:   isRTL ? "غير مرتبط" : "Not Linked",
    linkBtn:    isRTL ? "ربط" : "Link",
    unlinkBtn:  isRTL ? "إلغاء الربط" : "Unlink",
    selectUser: isRTL ? "اختر مستخدماً..." : "Select a user...",
    noUnlinked: isRTL ? "كل المندوبين مرتبطون بحسابات ✓" : "All salespersons linked ✓",
    password:   isRTL ? "كلمة المرور: sales123" : "Password: sales123",
    emailFmt:   isRTL ? "البريد: [كود المندوب]@gmail.com  (مثال: nsr1596@gmail.com)" : "Email: [code]@gmail.com  (e.g. nsr1596@gmail.com)",
    note:       isRTL
      ? "كل مندوب سيرى فقط عملاءه عند تسجيل الدخول."
      : "Each salesperson will only see their own clients when logged in.",
    whyUnlinked: isRTL
      ? "اضغط 'إنشاء وربط' أعلاه لربطهم تلقائياً، أو اربط يدوياً باختيار مستخدم."
      : "Press 'Auto-create & Link' above to fix all at once, or link manually per row.",
  };

  return (
    <div className="space-y-6">
      {/* Create accounts card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 text-primary" />
            {t.title}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Info pills */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 text-sm">
              <Key className="h-4 w-4 text-amber-500" />
              <span>{t.password}</span>
            </div>
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 text-sm">
              <Mail className="h-4 w-4 text-blue-500" />
              <span>{t.emailFmt}</span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2">
            {t.note}
          </p>

          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={handleCreateAll} disabled={creating} className="gap-2">
              {creating
                ? <><Loader2 className="h-4 w-4 animate-spin" />{t.creating}</>
                : <><UserPlus className="h-4 w-4" />{t.createBtn}</>}
            </Button>
            <Button variant="outline" onClick={handleResetPasswords} disabled={resetting} className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30">
              {resetting
                ? <><Loader2 className="h-4 w-4 animate-spin" />{isRTL ? "جارٍ الإعادة..." : "Resetting..."}</>
                : <><RotateCcw className="h-4 w-4" />{isRTL ? "إعادة تعيين كلمات المرور → sales123" : "Reset all passwords → sales123"}</>}
            </Button>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {t.refresh}
            </Button>
          </div>

          {resetResult && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="font-semibold text-green-700 dark:text-green-400">{resetResult.reset}</span>
                <span className="text-sm text-muted-foreground">{isRTL ? "تم تعيين كلمة المرور sales123" : "passwords reset to sales123"}</span>
              </div>
              {resetResult.failed > 0 && (
                <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="font-semibold text-red-700 dark:text-red-400">{resetResult.failed}</span>
                  <span className="text-sm text-muted-foreground">{isRTL ? "فشل" : "failed"}</span>
                </div>
              )}
            </motion.div>
          )}

          {createResult && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
              <div className="flex flex-wrap gap-3">
                {createResult.created > 0 && (
                  <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="font-semibold text-green-700 dark:text-green-400">{createResult.created}</span>
                    <span className="text-sm text-muted-foreground">{isRTL ? "تم إنشاؤه وربطه" : "Created & linked"}</span>
                  </div>
                )}
                {createResult.linked > 0 && (
                  <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2">
                    <Link2 className="h-4 w-4 text-blue-500" />
                    <span className="font-semibold text-blue-700 dark:text-blue-400">{createResult.linked}</span>
                    <span className="text-sm text-muted-foreground">{isRTL ? "تم ربطه تلقائياً" : "Auto-linked"}</span>
                  </div>
                )}
                {createResult.failed > 0 && (
                  <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="font-semibold text-red-700 dark:text-red-400">{createResult.failed}</span>
                    <span className="text-sm text-muted-foreground">{isRTL ? "فشل" : "Failed"}</span>
                  </div>
                )}
              </div>
              {(createResult.created + createResult.linked) > 0 && (
                <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                  {isRTL
                    ? `✓ تم ربط ${createResult.created + createResult.linked} مندوب — يمكنهم الآن تسجيل الدخول`
                    : `✓ ${createResult.created + createResult.linked} salesperson(s) linked — they can now log in`}
                </p>
              )}
            </motion.div>
          )}
        </CardContent>
      </Card>

      {/* Status summary */}
      {!loading && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-4 flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-green-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold text-green-700 dark:text-green-400">{linked.length}</p>
              <p className="text-xs text-muted-foreground">{t.linked}</p>
            </div>
          </div>
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-center gap-3">
            <AlertCircle className="h-8 w-8 text-amber-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{unlinked.length}</p>
              <p className="text-xs text-muted-foreground">{t.unlinked}</p>
            </div>
          </div>
        </div>
      )}

      {/* Unlinked salespersons — needs action */}
      {!loading && unlinked.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-4 w-4" />
              {t.unlinked} ({unlinked.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t.whyUnlinked}</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="rounded-b-lg overflow-hidden">
              {unlinked.map((sp, i) => (
                <motion.div
                  key={sp.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center gap-3 px-4 py-3 border-t border-border/50 hover:bg-muted/20 flex-wrap"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{sp.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{sp.code}</p>
                  </div>
                  {/* Manual link: pick an existing sales user */}
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedUser[sp.id] ?? ""}
                      onValueChange={(v) => setSelectedUser((prev) => ({ ...prev, [sp.id]: v }))}
                    >
                      <SelectTrigger className="h-8 w-52 text-xs">
                        <SelectValue placeholder={t.selectUser} />
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id} className="text-xs">
                            <span className="font-medium">{u.full_name}</span>
                            <span className="text-muted-foreground ml-1">({u.email})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      disabled={!selectedUser[sp.id] || linkingId === sp.id}
                      onClick={() => handleLink(sp.id)}
                    >
                      {linkingId === sp.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Link2 className="h-3.5 w-3.5" />}
                      {t.linkBtn}
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && unlinked.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3">
          <CheckCircle className="h-4 w-4 shrink-0" />
          {t.noUnlinked}
        </div>
      )}

      {/* Linked salespersons */}
      {!loading && linked.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              {t.linked} ({linked.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-start px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{isRTL ? "المندوب" : "Salesperson"}</th>
                    <th className="text-start px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{isRTL ? "الكود" : "Code"}</th>
                    <th className="text-start px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{isRTL ? "البريد الإلكتروني" : "Email"}</th>
                    <th className="text-start px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{isRTL ? "الحالة" : "Status"}</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {linked.map((sp, i) => (
                    <tr key={sp.id} className={`border-t border-border/50 hover:bg-muted/20 transition-colors ${i % 2 === 1 ? "bg-muted/5" : ""}`}>
                      <td className="px-4 py-2.5 font-medium">{sp.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{sp.code}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{sp.user_email ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100 text-[11px]">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {t.linked}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                          disabled={linkingId === sp.id}
                          onClick={() => handleUnlink(sp.id)}
                        >
                          {linkingId === sp.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Unlink className="h-3.5 w-3.5" />}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="space-y-2">
          {Array(4).fill(0).map((_, i) => (
            <div key={i} className="h-12 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      )}
    </div>
  );
}
