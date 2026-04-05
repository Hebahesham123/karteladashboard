"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Settings,
  TrendingUp,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  role?: "admin" | "sales" | "all";
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, role: "admin" },
  { label: "My Clients",  href: "/sales",     icon: TrendingUp,       role: "sales" },
  { label: "Clients",     href: "/clients",   icon: Users,            role: "admin" },
  { label: "Admin",       href: "/admin",     icon: Settings,         role: "admin" },
];

interface SidebarProps {
  role: "admin" | "sales";
  isCollapsed: boolean;
  onToggle: () => void;
  onSignOut: () => void;
  locale: string;
}

export function Sidebar({ role, isCollapsed, onToggle, onSignOut, locale }: SidebarProps) {
  const pathname = usePathname();
  const isRTL = locale === "ar";

  const filteredItems = navItems.filter(
    (item) => item.role === "all" || item.role === role
  );

  return (
    <motion.aside
      animate={{ width: isCollapsed ? 72 : 240 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className={cn(
        "fixed top-0 bottom-0 z-30 flex flex-col bg-card border-border",
        isRTL ? "right-0 border-l" : "left-0 border-r"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-border">
        {!isCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2"
          >
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">C</span>
            </div>
            <span className="font-bold text-foreground">
              {isRTL ? "كارتيلا" : "Cartela"}
            </span>
          </motion.div>
        )}
        {isCollapsed && (
          <div className="mx-auto h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">C</span>
          </div>
        )}
        {!isCollapsed && (
          <button
            onClick={onToggle}
            className="rounded-lg p-1.5 hover:bg-accent transition-colors"
          >
            {isRTL ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Toggle when collapsed */}
      {isCollapsed && (
        <button
          onClick={onToggle}
          className="mx-auto mt-2 rounded-lg p-1.5 hover:bg-accent transition-colors"
        >
          {isRTL ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2">
        <ul className="space-y-1">
          {filteredItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    isCollapsed && "justify-center"
                  )}
                  title={isCollapsed ? item.label : undefined}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!isCollapsed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="truncate"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Sign out */}
      <div className="border-t border-border p-2">
        <button
          onClick={onSignOut}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200",
            isCollapsed && "justify-center"
          )}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!isCollapsed && <span>{isRTL ? "تسجيل الخروج" : "Sign Out"}</span>}
        </button>
      </div>
    </motion.aside>
  );
}
