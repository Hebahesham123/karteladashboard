"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sidebar } from "@/components/layout/Sidebar";
import { Navbar } from "@/components/layout/Navbar";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/store/useStore";

const MOBILE_MQ = "(max-width: 767px)";
const WARMUP_CACHE_KEY = "app_warmup_v1";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { locale, setLocale, sidebarCollapsed, toggleSidebar, setSidebarCollapsed, currentUser, setCurrentUser, setSalespersonId } = useStore();
  const [loading, setLoading] = useState(true);
  const [adminAreaTitle, setAdminAreaTitle] = useState<string | null>(null);
  const isRTL = locale === "ar";

  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      // Fetch user profile
      const { data: user } = await supabase
        .from("users")
        .select("*")
        .eq("id", session.user.id)
        .single();

      if (user) {
        setCurrentUser(user);
        if (user.role === "admin") {
          try {
            const res = await fetch("/api/me/admin-area", { credentials: "include", cache: "no-store" });
            const json = await res.json();
            if (res.ok) {
              setAdminAreaTitle((json?.label as string | null) ?? null);
            } else {
              setAdminAreaTitle(null);
            }
          } catch {
            setAdminAreaTitle(null);
          }
        } else {
          setAdminAreaTitle(null);
        }
        // If sales role, look up their salesperson record
        if (user.role === "sales") {
          let { data: sp } = await supabase
            .from("salespersons")
            .select("id")
            .eq("user_id", session.user.id)
            .maybeSingle();

          // Auto-link silently on login if this sales account is not linked yet.
          if (!sp?.id) {
            await fetch("/api/fix-my-link", { method: "POST", credentials: "include" });
            const relink = await supabase
              .from("salespersons")
              .select("id")
              .eq("user_id", session.user.id)
              .maybeSingle();
            sp = relink.data ?? null;
          }
          setSalespersonId(sp?.id || null);
        } else {
          setSalespersonId(null);
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, [router, setCurrentUser, setSalespersonId]);

  useEffect(() => {
    if (!currentUser) return;
    if (typeof window !== "undefined" && window.sessionStorage.getItem(WARMUP_CACHE_KEY) === "1") return;
    const now = new Date();
    const month = now.getMonth() === 0 ? 12 : now.getMonth();
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const ctrl = new AbortController();
    const abortTimer = window.setTimeout(() => ctrl.abort(), 5000);

    // Warm up common API responses so screens feel instant on first open.
    void fetch(`/api/order-distinct-filters?month=${month}&year=${year}`, {
      credentials: "include",
      signal: ctrl.signal,
      cache: "no-store",
    }).catch(() => undefined);
    if (currentUser.role === "admin") {
      void fetch(`/api/urgent-orders/admin?salespersonId=__init__&month=${month}&year=${year}`, {
        credentials: "include",
        signal: ctrl.signal,
        cache: "no-store",
      }).catch(() => undefined);
    } else if (currentUser.role === "sales") {
      void fetch("/api/urgent-orders/my", {
        credentials: "include",
        signal: ctrl.signal,
        cache: "no-store",
      }).catch(() => undefined);
    }
    if (typeof window !== "undefined") window.sessionStorage.setItem(WARMUP_CACHE_KEY, "1");
    return () => {
      window.clearTimeout(abortTimer);
      ctrl.abort();
    };
  }, [currentUser]);

  const handleLocaleChange = (newLocale: string) => {
    setLocale(newLocale);
    document.documentElement.lang = newLocale;
    document.documentElement.dir = newLocale === "ar" ? "rtl" : "ltr";
    // Set cookie for server components
    document.cookie = `locale=${newLocale};path=/;max-age=31536000`;
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setCurrentUser(null);
    router.push("/login");
  };

  // Apply RTL/LTR direction
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
  }, [locale, isRTL]);

  // On narrow viewports, start with drawer closed (CSS also hides the 72px rail via max-md:!w-0)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const apply = () => {
      if (mq.matches) setSidebarCollapsed(true);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [setSidebarCollapsed]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-primary animate-pulse" />
          <div className="text-sm text-muted-foreground">
            {isRTL ? "جارٍ التحميل..." : "Loading..."}
          </div>
        </div>
      </div>
    );
  }

  const sidebarWidth = sidebarCollapsed ? 72 : 240;

  return (
    <div dir={isRTL ? "rtl" : "ltr"} className="min-h-screen bg-background">
      {!sidebarCollapsed && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-[35] bg-black/50 md:hidden"
          onClick={() => toggleSidebar()}
        />
      )}
      <Sidebar
        role={(currentUser?.role as "admin" | "sales") || "sales"}
        isCollapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        onSignOut={handleSignOut}
        locale={locale}
        onNavigate={() => {
          if (typeof window !== "undefined" && window.matchMedia(MOBILE_MQ).matches) {
            setSidebarCollapsed(true);
          }
        }}
      />

      <div
        className="min-w-0 transition-[margin] duration-200 max-md:!mx-0"
        style={{
          [isRTL ? "marginRight" : "marginLeft"]: `${sidebarWidth}px`,
        }}
      >
        <Navbar
          locale={locale}
          onLocaleChange={handleLocaleChange}
          user={currentUser || undefined}
          onMenuToggle={toggleSidebar}
          adminAreaTitle={adminAreaTitle}
        />

        <main className="p-2 pb-4 sm:p-4 md:p-6 overflow-x-hidden max-w-[100vw]">
          <AnimatePresence mode="wait">
            <motion.div
              key={typeof window !== "undefined" ? window.location.pathname : ""}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
