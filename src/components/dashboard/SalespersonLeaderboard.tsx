"use client";

import { motion } from "framer-motion";
import { Trophy, Medal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/utils";

interface SalespersonData {
  name: string;
  meters: number;
  clients: number;
  rank: number;
}

interface SalespersonLeaderboardProps {
  data: SalespersonData[];
  title: string;
  locale: string;
}

const rankColors = ["text-yellow-500", "text-gray-400", "text-amber-600"];
const rankBg = [
  "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800",
  "bg-gray-50 dark:bg-gray-950/20 border-gray-200 dark:border-gray-700",
  "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800",
];

export function SalespersonLeaderboard({ data, title, locale }: SalespersonLeaderboardProps) {
  const isRTL = locale === "ar";

  const maxMeters = data[0]?.meters || 1;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-yellow-500" />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.slice(0, 10).map((person, index) => {
            const percentage = (person.meters / maxMeters) * 100;
            const isTop3 = index < 3;

            return (
              <motion.div
                key={person.name}
                initial={{ opacity: 0, x: isRTL ? 20 : -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.04 }}
                className={`p-3 rounded-xl border ${
                  isTop3 ? rankBg[index] : "bg-muted/30 border-border/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Rank */}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                      isTop3
                        ? `${rankColors[index]} bg-white dark:bg-gray-900 shadow-sm border`
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {index < 3 ? (
                      <Medal className="h-4 w-4" />
                    ) : (
                      person.rank
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate">{person.name}</span>
                      <div className="text-right">
                        <span className="text-sm font-bold">
                          {formatNumber(person.meters)}m
                        </span>
                        <span className="text-xs text-muted-foreground ms-2">
                          {person.clients} {isRTL ? "عميل" : "clients"}
                        </span>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        transition={{ delay: index * 0.04 + 0.2, duration: 0.5 }}
                        className={`h-full rounded-full ${
                          isTop3
                            ? index === 0
                              ? "bg-yellow-500"
                              : index === 1
                              ? "bg-gray-400"
                              : "bg-amber-600"
                            : "bg-primary"
                        }`}
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
