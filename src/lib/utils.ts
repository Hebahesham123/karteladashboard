import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { OrderLevel, ClientStatus } from "@/types/database";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getOrderLevel(meters: number): OrderLevel {
  if (meters === 0) return "RED";
  if (meters < 100) return "ORANGE";
  return "GREEN";
}

export function getLevelColor(level: OrderLevel): string {
  switch (level) {
    case "RED":      return "text-red-500";
    case "ORANGE":   return "text-orange-500";
    case "GREEN":    return "text-green-500";
    case "INACTIVE": return "text-slate-400";
    default:         return "text-gray-500";
  }
}

export function getLevelBgColor(level: OrderLevel): string {
  switch (level) {
    case "RED":      return "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800";
    case "ORANGE":   return "bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800";
    case "GREEN":    return "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800";
    case "INACTIVE": return "bg-slate-50 border-slate-200 dark:bg-slate-900/30 dark:border-slate-700";
    default:         return "bg-gray-50 border-gray-200";
  }
}

export function getLevelBadgeColor(level: OrderLevel): string {
  switch (level) {
    case "RED":      return "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400";
    case "ORANGE":   return "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400";
    case "GREEN":    return "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400";
    case "INACTIVE": return "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400";
    default:         return "bg-gray-100 text-gray-700";
  }
}

export function getStatusColor(status: ClientStatus): string {
  switch (status) {
    case "NEW":
      return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400";
    case "FOLLOW_UP_1":
      return "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400";
    case "FOLLOW_UP_2":
      return "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400";
    case "RECOVERED":
      return "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400";
    case "LOST":
      return "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400";
    case "CANCELLED":
      return "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

/** Exclude from salesperson meter rankings (e.g. internal staff not a field rep). Matched on first name token. */
export function isExcludedFromSalesLeaderboard(displayName: string): boolean {
  const first = (displayName || "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return first === "aml";
}

/** Exclude from client meter rankings (aggregate / non-client lines that should not appear as a ranked customer). */
export function isExcludedFromClientLeaderboard(clientName: string): boolean {
  const n = (clientName || "").replace(/\s+/g, " ").trim();
  if (!n) return false;
  if (n.includes("اكسسوار ستارة") && n.includes("تجزئة")) return true;
  if (/curtain\s*accessory/i.test(n) && /retail|client/i.test(n)) return true;
  return false;
}

export function formatNumber(num: number, decimals = 1): string {
  if (num >= 1000000) {
    const v = num / 1000000;
    return `${Number.isInteger(v) ? v : v.toFixed(decimals)}M`;
  }
  if (num >= 1000) {
    const v = num / 1000;
    return `${Number.isInteger(v) ? v : v.toFixed(decimals)}K`;
  }
  return Number.isInteger(num) ? String(num) : num.toFixed(decimals);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function getMonthName(month: number, locale: string = "en"): string {
  const date = new Date(2024, month - 1, 1);
  return date.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
    month: "long",
  });
}

export function calculateGrowthRate(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export function detectAtRiskClients(
  currentMeters: number,
  previousMeters: number,
  threshold = 30
): boolean {
  if (currentMeters === 0) return true;
  if (previousMeters > 0) {
    const decline = ((previousMeters - currentMeters) / previousMeters) * 100;
    if (decline >= threshold) return true;
  }
  return currentMeters < 100;
}
