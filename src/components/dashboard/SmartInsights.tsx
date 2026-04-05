"use client";

import { motion } from "framer-motion";
import { AlertTriangle, TrendingDown, UserCheck, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface InsightItem {
  id: string;
  type: "at_risk" | "declining" | "follow_up" | "anomaly";
  clientName: string;
  detail: string;
  severity: "high" | "medium" | "low";
}

interface SmartInsightsProps {
  insights: InsightItem[];
  title: string;
  locale: string;
  onClientClick?: (id: string) => void;
}

const insightConfig = {
  at_risk: {
    icon: AlertTriangle,
    color: "text-red-500",
    bg: "bg-red-50 dark:bg-red-950/20",
    badgeVariant: "danger" as const,
    label: { ar: "في خطر", en: "At Risk" },
  },
  declining: {
    icon: TrendingDown,
    color: "text-orange-500",
    bg: "bg-orange-50 dark:bg-orange-950/20",
    badgeVariant: "warning" as const,
    label: { ar: "متراجع", en: "Declining" },
  },
  follow_up: {
    icon: UserCheck,
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/20",
    badgeVariant: "info" as const,
    label: { ar: "يحتاج متابعة", en: "Follow Up" },
  },
  anomaly: {
    icon: Zap,
    color: "text-purple-500",
    bg: "bg-purple-50 dark:bg-purple-950/20",
    badgeVariant: "default" as const,
    label: { ar: "شذوذ", en: "Anomaly" },
  },
};

export function SmartInsights({ insights, title, locale, onClientClick }: SmartInsightsProps) {
  const isRTL = locale === "ar";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant="secondary">{insights.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {insights.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {isRTL ? "لا توجد تنبيهات حالياً" : "No insights at the moment"}
          </p>
        ) : (
          insights.map((insight, index) => {
            const config = insightConfig[insight.type];
            const Icon = config.icon;
            const label = isRTL ? config.label.ar : config.label.en;

            return (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, x: isRTL ? 10 : -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => onClientClick?.(insight.id)}
                className={`flex items-start gap-3 p-3 rounded-xl ${config.bg} border border-border/50 ${onClientClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
              >
                <div className={`mt-0.5 ${config.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">
                      {insight.clientName}
                    </span>
                    <Badge variant={config.badgeVariant} className="text-xs shrink-0">
                      {label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {insight.detail}
                  </p>
                </div>
              </motion.div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
