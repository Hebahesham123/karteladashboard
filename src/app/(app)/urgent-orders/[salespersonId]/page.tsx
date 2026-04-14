"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useStore } from "@/store/useStore";
import { PageBack } from "@/components/layout/PageBack";
import { UrgentOrdersManager } from "@/components/admin/UrgentOrdersManager";

export default function UrgentOrdersBySalespersonPage() {
  const { locale, currentUser } = useStore();
  const router = useRouter();
  const params = useParams<{ salespersonId: string }>();
  const isRTL = locale === "ar";

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin") router.push("/dashboard");
  }, [currentUser, router]);

  if (currentUser?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">{isRTL ? "غير مصرح لك بالوصول" : "Access denied"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageBack locale={locale} fallbackHref="/urgent-orders" />
      <div>
        <h1 className="text-2xl font-bold">{isRTL ? "طلبات المندوب" : "Salesperson Orders"}</h1>
      </div>
      <UrgentOrdersManager
        locale={locale}
        initialSalespersonId={params.salespersonId}
        showSalespersonCards={false}
      />
    </div>
  );
}
