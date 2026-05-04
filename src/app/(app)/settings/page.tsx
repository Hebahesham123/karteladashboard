"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Lock, Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";
import { useStore } from "@/store/useStore";

export default function SettingsPage() {
  const { locale, currentUser } = useStore();
  const isRTL = locale === "ar";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const t = {
    title: isRTL ? "الإعدادات" : "Settings",
    subtitle: isRTL ? "إدارة حسابك" : "Manage your account",
    accountInfo: isRTL ? "معلومات الحساب" : "Account info",
    email: isRTL ? "البريد الإلكتروني" : "Email",
    role: isRTL ? "الصلاحية" : "Role",
    changePassword: isRTL ? "تغيير كلمة المرور" : "Change password",
    changeDesc: isRTL
      ? "أدخل كلمة المرور الحالية والجديدة. يجب أن تكون الجديدة 6 أحرف على الأقل."
      : "Enter your current and new password. New password must be at least 6 characters.",
    current: isRTL ? "كلمة المرور الحالية" : "Current password",
    next: isRTL ? "كلمة المرور الجديدة" : "New password",
    confirm: isRTL ? "تأكيد كلمة المرور الجديدة" : "Confirm new password",
    save: isRTL ? "حفظ" : "Save",
    saving: isRTL ? "جاري الحفظ..." : "Saving...",
    mismatch: isRTL ? "كلمتا المرور الجديدتان غير متطابقتين" : "New passwords do not match",
    successMsg: isRTL ? "تم تغيير كلمة المرور بنجاح" : "Password changed successfully",
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError(t.mismatch);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/me/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Failed");
      } else {
        setSuccess(t.successMsg);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6" dir={isRTL ? "rtl" : "ltr"}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.accountInfo}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t.email}</span>
            <span className="font-medium">{currentUser?.email ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t.role}</span>
            <span className="font-medium capitalize">{currentUser?.role ?? "—"}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" />
            {t.changePassword}
          </CardTitle>
          <CardDescription>{t.changeDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t.current}</label>
              <div className="relative">
                <Input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className={isRTL ? "pl-10" : "pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground ${isRTL ? "left-3" : "right-3"}`}
                  tabIndex={-1}
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t.next}</label>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className={isRTL ? "pl-10" : "pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground ${isRTL ? "left-3" : "right-3"}`}
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t.confirm}</label>
              <Input
                type={showNew ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 text-destructive p-3 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 p-3 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{success}</span>
              </div>
            )}

            <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t.saving}
                </>
              ) : (
                t.save
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
