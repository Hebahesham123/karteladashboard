"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageBackProps {
  locale: string;
  /** When history is empty, `router.back()` may no-op; push here instead. */
  fallbackHref?: string;
}

export function PageBack({ locale, fallbackHref = "/dashboard" }: PageBackProps) {
  const router = useRouter();
  const isRTL = locale === "ar";
  const Icon = isRTL ? ArrowRight : ArrowLeft;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-1.5 -ms-1 h-8 px-2 text-muted-foreground hover:text-foreground"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-sm">{isRTL ? "رجوع" : "Back"}</span>
    </Button>
  );
}
