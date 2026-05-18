"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, EyeOff, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { locale, setLocale } = useStore();
  const isRTL = locale === "ar";

  const [checking, setChecking] = useState(true);
  const [emailLabel, setEmailLabel] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setEmailLabel(session.user.email ?? "");
      setChecking(false);
    })();
  }, [router]);

  const t = {
    title: isRTL ? "يرجى تغيير كلمة المرور" : "Please change your password",
    subtitle: isRTL
      ? "لحماية حسابك، يجب تغيير كلمة المرور قبل المتابعة."
      : "For your security, you must change your password before continuing.",
    current: isRTL ? "كلمة المرور الحالية" : "Current password",
    next: isRTL ? "كلمة المرور الجديدة" : "New password",
    confirm: isRTL ? "تأكيد كلمة المرور الجديدة" : "Confirm new password",
    submit: isRTL ? "حفظ ومتابعة" : "Save & continue",
    submitting: isRTL ? "جارٍ الحفظ..." : "Saving...",
    minLen: isRTL
      ? "يجب ألا تقل كلمة المرور الجديدة عن 6 أحرف"
      : "New password must be at least 6 characters",
    mismatch: isRTL
      ? "كلمتا المرور الجديدتان غير متطابقتين"
      : "New passwords do not match",
    samePassword: isRTL
      ? "يجب أن تكون كلمة المرور الجديدة مختلفة"
      : "New password must be different from the current one",
    failed: isRTL ? "تعذر تغيير كلمة المرور" : "Failed to change password",
    signOut: isRTL ? "تسجيل الخروج" : "Sign out",
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cur = currentPassword.trim();
    const next = newPassword.trim();
    const conf = confirmPassword.trim();
    if (next.length < 6) {
      setError(t.minLen);
      return;
    }
    if (next !== conf) {
      setError(t.mismatch);
      return;
    }
    if (cur === next) {
      setError(t.samePassword);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/me/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error || t.failed);
        return;
      }
      // Refresh the JWT so the cleared metadata is in the new access token,
      // then do a hard navigation so the (app) layout reads the fresh session.
      try {
        const supabase = createClient();
        await supabase.auth.refreshSession();
      } catch {
        // ignore
      }
      if (typeof window !== "undefined") {
        window.location.replace("/dashboard");
      } else {
        router.replace("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-gray-950 dark:via-gray-900 dark:to-amber-950 flex items-center justify-center p-4"
    >
      <div className={`absolute top-4 ${isRTL ? "left-4" : "right-4"} flex gap-2`}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
        >
          {locale === "ar" ? "English" : "عربي"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void handleSignOut()}>
          {t.signOut}
        </Button>
      </div>

      <div className="w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500 shadow-lg mb-4">
            <ShieldAlert className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{t.title}</h1>
          <p className="text-muted-foreground mt-2 text-sm">{t.subtitle}</p>
          {emailLabel && (
            <p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <span className="font-mono">{emailLabel}</span>
            </p>
          )}
        </motion.div>

        <motion.form
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          onSubmit={handleSubmit}
          className="bg-card border border-border rounded-2xl shadow-xl p-6 space-y-4"
        >
          <PasswordField
            label={t.current}
            value={currentPassword}
            onChange={setCurrentPassword}
            show={showCurrent}
            toggle={() => setShowCurrent((v) => !v)}
            autoComplete="current-password"
            isRTL={isRTL}
            disabled={submitting}
          />
          <PasswordField
            label={t.next}
            value={newPassword}
            onChange={setNewPassword}
            show={showNew}
            toggle={() => setShowNew((v) => !v)}
            autoComplete="new-password"
            isRTL={isRTL}
            disabled={submitting}
          />
          <PasswordField
            label={t.confirm}
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={showConfirm}
            toggle={() => setShowConfirm((v) => !v)}
            autoComplete="new-password"
            isRTL={isRTL}
            disabled={submitting}
          />

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full h-11 gap-2" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t.submitting}
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" />
                {t.submit}
              </>
            )}
          </Button>
        </motion.form>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  show,
  toggle,
  autoComplete,
  isRTL,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  toggle: () => void;
  autoComplete: string;
  isRTL: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          required
          autoComplete={autoComplete}
          disabled={disabled}
          className={`h-11 ${isRTL ? "pl-10" : "pr-10"}`}
        />
        <button
          type="button"
          onClick={toggle}
          tabIndex={-1}
          className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors ${isRTL ? "left-3" : "right-3"}`}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
