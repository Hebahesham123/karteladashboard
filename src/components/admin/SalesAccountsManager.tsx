"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { UserPlus, CheckCircle, XCircle, Loader2, Users, Key, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AccountResult {
  code: string;
  email: string;
  status: string;
}

interface Props {
  locale: string;
}

export function SalesAccountsManager({ locale }: Props) {
  const isRTL = locale === "ar";
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; failed: number; accounts: AccountResult[] } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const t = {
    title:   isRTL ? "حسابات المندوبين" : "Salesperson Accounts",
    subtitle: isRTL
      ? "إنشاء حسابات تسجيل دخول لجميع المندوبين تلقائياً"
      : "Auto-create login accounts for all salespersons",
    create:  isRTL ? "إنشاء الحسابات" : "Create Accounts",
    creating: isRTL ? "جارٍ الإنشاء..." : "Creating...",
    created:  isRTL ? "تم الإنشاء" : "Created",
    skipped:  isRTL ? "موجود مسبقاً" : "Already exists",
    failed:   isRTL ? "فشل" : "Failed",
    password: isRTL ? "كلمة المرور الموحدة: sales123" : "Default password: sales123",
    emailFmt: isRTL ? "البريد: [كود المندوب]@gmail.com" : "Email: [code]@gmail.com",
    showMore: isRTL ? "عرض الكل" : "Show all",
    showLess: isRTL ? "إخفاء" : "Show less",
    note: isRTL
      ? "كل مندوب سيرى فقط عملاءه وطلباته عند تسجيل الدخول."
      : "Each salesperson will only see their own clients and orders when logged in.",
  };

  const handleCreate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/create-accounts", { method: "POST" });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ created: 0, skipped: 0, failed: 1, accounts: [] });
    }
    setLoading(false);
  };

  const displayAccounts = showAll ? result?.accounts : result?.accounts.slice(0, 10);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {t.title}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Info pills */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 text-sm">
              <Key className="h-4 w-4 text-amber-500" />
              <span>{t.password}</span>
            </div>
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 text-sm">
              <Mail className="h-4 w-4 text-blue-500" />
              <span>{t.emailFmt}</span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2">
            {t.note}
          </p>

          <Button onClick={handleCreate} disabled={loading} className="gap-2">
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" />{t.creating}</>
              : <><UserPlus className="h-4 w-4" />{t.create}</>
            }
          </Button>

          {/* Results summary */}
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="font-semibold text-green-700 dark:text-green-400">{result.created}</span>
                  <span className="text-sm text-muted-foreground">{t.created}</span>
                </div>
                <div className="flex items-center gap-2 bg-muted rounded-lg px-4 py-2">
                  <span className="font-semibold">{result.skipped}</span>
                  <span className="text-sm text-muted-foreground">{t.skipped}</span>
                </div>
                {result.failed > 0 && (
                  <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="font-semibold text-red-700 dark:text-red-400">{result.failed}</span>
                    <span className="text-sm text-muted-foreground">{t.failed}</span>
                  </div>
                )}
              </div>

              {/* Accounts table */}
              {result.accounts.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-start px-4 py-2 font-medium">{isRTL ? "الكود" : "Code"}</th>
                        <th className="text-start px-4 py-2 font-medium">{isRTL ? "البريد الإلكتروني" : "Email"}</th>
                        <th className="text-start px-4 py-2 font-medium">{isRTL ? "الحالة" : "Status"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayAccounts?.map((a, i) => (
                        <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2 font-mono font-bold">{a.code}</td>
                          <td className="px-4 py-2 text-muted-foreground">{a.email}</td>
                          <td className="px-4 py-2">
                            {a.status === "created" && <Badge className="bg-green-100 text-green-700 hover:bg-green-100">{t.created}</Badge>}
                            {a.status === "already_exists" && <Badge variant="secondary">{t.skipped}</Badge>}
                            {a.status.startsWith("error") && <Badge variant="destructive">{a.status.replace("error: ", "")}</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.accounts.length > 10 && (
                    <div className="px-4 py-2 border-t bg-muted/20 text-center">
                      <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
                        {showAll ? t.showLess : `${t.showMore} (${result.accounts.length})`}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
