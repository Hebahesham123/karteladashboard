"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useStore } from "@/store/useStore";
import { PageBack } from "@/components/layout/PageBack";
import { UrgentOrdersManager } from "@/components/admin/UrgentOrdersManager";
import { createClient } from "@/lib/supabase/client";

export default function UrgentOrdersBySalespersonPage() {
  const { locale, currentUser } = useStore();
  const router = useRouter();
  const params = useParams<{ salespersonId: string }>();
  const isRTL = locale === "ar";
  const [salesHead, setSalesHead] = useState<{ name: string; code: string } | null>(null);

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin") router.push("/dashboard");
  }, [currentUser, router]);

  useEffect(() => {
    const id = params.salespersonId;
    if (!id || currentUser?.role !== "admin") return;
    setSalesHead(null);
    let active = true;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("salespersons").select("name, code").eq("id", id).maybeSingle();
      if (!active || !data) return;
      setSalesHead({ name: data.name as string, code: data.code as string });
    })();
    return () => {
      active = false;
    };
  }, [params.salespersonId, currentUser?.role]);

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
        <h1 className="text-2xl font-bold">
          {salesHead
            ? isRTL
              ? `${salesHead.name} — الطلبات العاجلة`
              : `${salesHead.name} — Orders`
            : isRTL
              ? "طلبات المندوب"
              : "Salesperson Orders"}
        </h1>
        {salesHead && (
          <p className="text-sm text-muted-foreground font-mono mt-1" dir="ltr">
            {salesHead.code}
          </p>
        )}
      </div>
      <UrgentOrdersManager
        locale={locale}
        initialSalespersonId={params.salespersonId}
        showSalespersonCards={false}
      />
    </div>
  );
}
