"use client";

import { useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExcelUpload } from "@/components/admin/ExcelUpload";
import { UserManagement } from "@/components/admin/UserManagement";
import { ActivityLogTable } from "@/components/admin/ActivityLogTable";
import { SalesAccountsManager } from "@/components/admin/SalesAccountsManager";
import { useStore } from "@/store/useStore";
import { PageBack } from "@/components/layout/PageBack";
import { Upload, Users, Activity, ShieldAlert, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";

export default function AdminPage() {
  const { locale, currentUser } = useStore();
  const router = useRouter();
  const isRTL = locale === "ar";

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin") {
      router.push("/dashboard");
    }
  }, [currentUser, router]);

  if (currentUser?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">
          {isRTL ? "غير مصرح لك بالوصول" : "Access denied"}
        </p>
      </div>
    );
  }

  const t = {
    title: isRTL ? "لوحة الإدارة" : "Admin Panel",
    subtitle: isRTL ? "إدارة وضبط النظام" : "System administration and management",
    upload: isRTL ? "رفع البيانات" : "Upload Data",
    users: isRTL ? "المستخدمون" : "Users",
    logs: isRTL ? "سجل النشاط" : "Activity Log",
    salesAccounts: isRTL ? "حسابات المندوبين" : "Sales Accounts",
  };

  return (
    <div className="space-y-6">
      <PageBack locale={locale} fallbackHref="/dashboard" />
      <div>
        <h1 className="text-2xl font-bold">{t.title}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t.subtitle}</p>
      </div>

      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="h-4 w-4" />
            {t.upload}
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            {t.users}
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-2">
            <Activity className="h-4 w-4" />
            {t.logs}
          </TabsTrigger>
          <TabsTrigger value="sales-accounts" className="gap-2">
            <UserCog className="h-4 w-4" />
            {t.salesAccounts}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-6">
          <ExcelUpload locale={locale} />
        </TabsContent>

        <TabsContent value="users" className="mt-6">
          <UserManagement locale={locale} />
        </TabsContent>

        <TabsContent value="logs" className="mt-6">
          <ActivityLogTable locale={locale} />
        </TabsContent>

        <TabsContent value="sales-accounts" className="mt-6">
          <SalesAccountsManager locale={locale} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
