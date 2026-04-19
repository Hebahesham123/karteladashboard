"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Settings,
  TrendingUp,
  BarChart3,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Layers,
  UserSearch,
  Siren,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  role?: "admin" | "sales" | "all";
  labelEn: string;
  labelAr: string;
}

const navItems: NavItem[] = [
  { labelEn: "Dashboard", labelAr: "لوحة التحكم", href: "/dashboard", icon: LayoutDashboard, role: "admin" },
  { labelEn: "Kartela analysis", labelAr: "تحليل الكارتيلا", href: "/kartela-analysis", icon: Layers, role: "admin" },
  {
    labelEn: "Clients by category & price",
    labelAr: "عملاء حسب التصنيف والسعر",
    href: "/clients-by-category-price",
    icon: UserSearch,
    role: "admin",
  },
  { labelEn: "Comparison", labelAr: "مقارنة", href: "/comparison", icon: BarChart3, role: "admin" },
  { labelEn: "Branches", labelAr: "الفروع", href: "/branches", icon: GitBranch, role: "admin" },
  { labelEn: "My Clients", labelAr: "عملائي", href: "/sales", icon: TrendingUp, role: "sales" },
  { labelEn: "Kartela analysis", labelAr: "تحليل الكارتيلا", href: "/kartela-analysis", icon: Layers, role: "sales" },
  {
    labelEn: "Clients by category & price",
    labelAr: "عملاء حسب التصنيف والسعر",
    href: "/clients-by-category-price",
    icon: UserSearch,
    role: "sales",
  },
  { labelEn: "Comparison", labelAr: "مقارنة", href: "/comparison", icon: BarChart3, role: "sales" },
  { labelEn: "Clients", labelAr: "العملاء", href: "/clients", icon: Users, role: "admin" },
  { labelEn: "Urgent Orders", labelAr: "الطلبات العاجلة", href: "/urgent-orders", icon: Siren, role: "admin" },
  { labelEn: "Admin", labelAr: "الإدارة", href: "/admin", icon: Settings, role: "admin" },
];

interface SidebarProps {
  role: "admin" | "sales";
  isCollapsed: boolean;
  onToggle: () => void;
  onSignOut: () => void;
  locale: string;
  onNavigate?: () => void;
}

export function Sidebar({ role, isCollapsed, onToggle, onSignOut, locale, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isRTL = locale === "ar";

  const filteredItems = useMemo(
    () => navItems.filter((item) => item.role === "all" || item.role === role),
    [role]
  );

  useEffect(() => {
    filteredItems.forEach((item) => {
      router.prefetch(item.href);
    });
  }, [filteredItems, router]);

  return (
    <aside
      className={cn(
        "app-shell-sidebar fixed top-0 bottom-0 z-[40] flex flex-col bg-card border-border overflow-hidden transition-[width] duration-200 ease-in-out",
        isRTL ? "right-0 border-l" : "left-0 border-r",
        /* Desktop: 72px collapsed / 240px expanded — framer not used so max-md !w always wins on phones */
        isCollapsed
          ? "w-[72px] max-md:!w-0 max-md:!min-w-0 max-md:border-0 max-md:!shadow-none max-md:pointer-events-none"
          : "w-[240px] max-md:!w-[min(260px,88vw)] max-md:max-w-[260px]"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 md:h-16 items-center justify-between px-3 md:px-4 border-b border-border shrink-0">
        {!isCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 min-w-0"
          >
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <span className="text-primary-foreground font-bold text-sm">C</span>
            </div>
            <span className="font-bold text-foreground truncate">
              {isRTL ? "كارتيلا" : "Cartela"}
            </span>
          </motion.div>
        )}
        {isCollapsed && (
          <div className="mx-auto h-8 w-8 rounded-lg bg-primary flex items-center justify-center max-md:hidden">
            <span className="text-primary-foreground font-bold text-sm">C</span>
          </div>
        )}
        {!isCollapsed && (
          <button type="button" onClick={onToggle} className="rounded-lg p-1.5 hover:bg-accent transition-colors shrink-0">
            {isRTL ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Expand rail — desktop only (mobile uses navbar menu) */}
      {isCollapsed && (
        <button
          type="button"
          onClick={onToggle}
          className="mx-auto mt-2 rounded-lg p-1.5 hover:bg-accent transition-colors max-md:hidden"
        >
          {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      )}

      <nav className="flex-1 overflow-y-auto py-3 md:py-4 px-2">
        <ul className="space-y-0.5 md:space-y-1">
          {filteredItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const label = isRTL ? item.labelAr : item.labelEn;
            return (
              <li key={`${item.role}-${item.href}`}>
                <Link
                  href={item.href}
                  onClick={() => onNavigate?.()}
                  onMouseEnter={() => router.prefetch(item.href)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2 md:py-2.5 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    isCollapsed && "justify-center"
                  )}
                  title={isCollapsed ? label : undefined}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!isCollapsed && (
                    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="truncate">
                      {label}
                    </motion.span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border p-2 shrink-0">
        <button
          type="button"
          onClick={onSignOut}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl px-3 py-2 md:py-2.5 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200",
            isCollapsed && "justify-center"
          )}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!isCollapsed && <span>{isRTL ? "تسجيل الخروج" : "Sign Out"}</span>}
        </button>
      </div>
    </aside>
  );
}
