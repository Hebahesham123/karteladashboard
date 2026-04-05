"use client";

import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, ArrowRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  description?: string;   // short explanation shown below title
  trend?: number;
  icon: React.ReactNode;
  color?: "blue" | "green" | "orange" | "red" | "purple";
  index?: number;
  onClick?: () => void;
  clickLabel?: string;
}

const colorMap = {
  blue:   { bg: "from-blue-500 to-blue-600",   light: "bg-blue-50 dark:bg-blue-950/30",   ring: "hover:ring-blue-400",   text: "text-blue-600 dark:text-blue-400",   badge: "bg-blue-100 dark:bg-blue-900/40" },
  green:  { bg: "from-green-500 to-green-600", light: "bg-green-50 dark:bg-green-950/30", ring: "hover:ring-green-400", text: "text-green-600 dark:text-green-400", badge: "bg-green-100 dark:bg-green-900/40" },
  orange: { bg: "from-orange-500 to-orange-600", light: "bg-orange-50 dark:bg-orange-950/30", ring: "hover:ring-orange-400", text: "text-orange-600 dark:text-orange-400", badge: "bg-orange-100 dark:bg-orange-900/40" },
  red:    { bg: "from-red-500 to-red-600",     light: "bg-red-50 dark:bg-red-950/30",     ring: "hover:ring-red-400",   text: "text-red-600 dark:text-red-400",     badge: "bg-red-100 dark:bg-red-900/40" },
  purple: { bg: "from-purple-500 to-purple-600", light: "bg-purple-50 dark:bg-purple-950/30", ring: "hover:ring-purple-400", text: "text-purple-600 dark:text-purple-400", badge: "bg-purple-100 dark:bg-purple-900/40" },
};

export function KPICard({ title, value, subtitle, description, trend, icon, color = "blue", index = 0, onClick, clickLabel }: KPICardProps) {
  const colors = colorMap[color];
  const TrendIcon = trend === undefined || trend === 0 ? Minus : trend > 0 ? TrendingUp : TrendingDown;
  const trendColor = trend === undefined || trend === 0 ? "text-muted-foreground" : trend > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
  const isClickable = !!onClick;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      whileHover={isClickable ? { y: -3, scale: 1.02 } : {}}
      whileTap={isClickable ? { scale: 0.98 } : {}}
      onClick={onClick}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border p-5 shadow-sm transition-all duration-200",
        colors.light,
        isClickable && "cursor-pointer ring-2 ring-transparent hover:shadow-lg",
        isClickable && colors.ring
      )}
    >
      {/* Decorative circle */}
      <div className={`absolute -top-6 -right-6 h-24 w-24 rounded-full bg-gradient-to-br ${colors.bg} opacity-10`} />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {description && (
              <div className="group relative">
                <Info className="h-3.5 w-3.5 text-muted-foreground/50 hover:text-muted-foreground cursor-help" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-popover border border-border rounded-xl shadow-xl text-xs text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 max-w-[220px] whitespace-normal text-center">
                  {description}
                </div>
              </div>
            )}
          </div>
          <p className="text-3xl font-bold text-foreground mt-1 truncate">{value}</p>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {trend !== undefined && (
              <div className="flex items-center gap-1">
                <TrendIcon className={cn("h-3.5 w-3.5", trendColor)} />
                <span className={cn("text-xs font-semibold", trendColor)}>
                  {Math.abs(trend).toFixed(1)}%
                </span>
              </div>
            )}
            {subtitle && (
              <span className="text-xs text-muted-foreground">{subtitle}</span>
            )}
          </div>

          {isClickable && clickLabel && (
            <div className={cn("inline-flex items-center gap-1 mt-3 text-xs font-semibold px-2 py-1 rounded-full", colors.badge, colors.text)}>
              <span>{clickLabel}</span>
              <ArrowRight className="h-3 w-3" />
            </div>
          )}
        </div>

        <div className={`shrink-0 rounded-xl p-3 bg-gradient-to-br ${colors.bg} shadow-sm`}>
          <div className="text-white h-6 w-6 flex items-center justify-center">{icon}</div>
        </div>
      </div>
    </motion.div>
  );
}
