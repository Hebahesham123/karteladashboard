"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, EyeOff, BarChart3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";

export default function LoginPage() {
  const router = useRouter();
  const { locale, setLocale } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isRTL = locale === "ar";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      // Fetch role to decide which landing page to use
      const supabase2 = createClient();
      const { data: { user } } = await supabase2.auth.getUser();
      let role = "admin";
      if (user) {
        const { data: profile } = await supabase2
          .from("users")
          .select("role")
          .eq("id", user.id)
          .single();
        role = profile?.role ?? "admin";
      }

      router.push(role === "sales" ? "/sales" : "/dashboard");
      router.refresh();
    } catch {
      setError(isRTL ? "حدث خطأ غير متوقع" : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-950 dark:via-gray-900 dark:to-blue-950 flex items-center justify-center p-4"
    >
      {/* Language toggle */}
      <div className="absolute top-4 right-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
        >
          {locale === "ar" ? "English" : "عربي"}
        </Button>
      </div>

      <div className="w-full max-w-md">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary shadow-lg mb-4">
            <BarChart3 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">
            {isRTL ? "تحليلات كارتيلا" : "Cartela Analytics"}
          </h1>
          <p className="text-muted-foreground mt-2">
            {isRTL
              ? "منصة المبيعات وتحليلات العملاء"
              : "Sales & Client Analytics Platform"}
          </p>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-card border border-border rounded-2xl shadow-xl p-8"
        >
          <h2 className="text-xl font-semibold mb-2">
            {isRTL ? "مرحباً بعودتك" : "Welcome back"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {isRTL
              ? "سجّل دخولك للمتابعة"
              : "Sign in to your account to continue"}
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {isRTL ? "البريد الإلكتروني" : "Email address"}
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={isRTL ? "example@company.com" : "example@company.com"}
                required
                disabled={loading}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                {isRTL ? "كلمة المرور" : "Password"}
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={loading}
                  className={`h-11 ${isRTL ? "pl-10" : "pr-10"}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors ${isRTL ? "left-3" : "right-3"}`}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm"
              >
                {error}
              </motion.div>
            )}

            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isRTL ? "جارٍ تسجيل الدخول..." : "Signing in..."}
                </>
              ) : (
                isRTL ? "تسجيل الدخول" : "Sign In"
              )}
            </Button>
          </form>

          {/* Credentials hint */}
          <div className="mt-6 p-4 rounded-xl bg-muted/50 border border-border space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              {isRTL ? "بيانات تسجيل الدخول:" : "Login credentials:"}
            </p>
            <div className="space-y-2 text-xs">
              <div className="rounded-lg bg-background border border-border px-3 py-2">
                <p className="font-semibold text-foreground mb-0.5">{isRTL ? "مدير النظام" : "Admin"}</p>
                <p className="text-muted-foreground font-mono">admin@cartela.com</p>
                <p className="text-muted-foreground font-mono">{isRTL ? "كلمة المرور:" : "Password:"} Admin@123456</p>
              </div>
              <div className="rounded-lg bg-background border border-border px-3 py-2">
                <p className="font-semibold text-foreground mb-0.5">{isRTL ? "مندوب مبيعات" : "Salesperson"}</p>
                <p className="text-muted-foreground">{isRTL ? "البريد: [كود]@gmail.com  (مثال: nsr2988@gmail.com)" : "Email: [code]@gmail.com  (e.g. nsr2988@gmail.com)"}</p>
                <p className="text-muted-foreground font-mono">{isRTL ? "كلمة المرور:" : "Password:"} <span className="font-bold text-foreground">sales123</span></p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
