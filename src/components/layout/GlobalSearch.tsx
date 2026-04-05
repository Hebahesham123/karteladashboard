"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, User, Package, Users, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

interface SearchResult {
  type: "client" | "product" | "salesperson";
  id: string;
  label: string;
  sub?: string;
}

interface GlobalSearchProps {
  locale: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function GlobalSearch({ locale }: GlobalSearchProps) {
  const isRTL = locale === "ar";
  const router = useRouter();

  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<SearchResult[]>([]);
  const [loading, setLoading]   = useState(false);
  const [open, setOpen]         = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const inputRef      = useRef<HTMLInputElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const debouncedQ    = useDebounce(query.trim(), 280);

  const search = useCallback(async (q: string) => {
    if (!q || q.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const supabase = createClient();
    const like = `%${q}%`;

    const [clients, products, salespersons] = await Promise.all([
      supabase
        .from("clients")
        .select("id, name, partner_id")
        .or(`name.ilike.${like},partner_id.ilike.${like}`)
        .limit(5),
      supabase
        .from("products")
        .select("id, name")
        .ilike("name", like)
        .limit(5),
      supabase
        .from("salespersons")
        .select("id, name, code")
        .or(`name.ilike.${like},code.ilike.${like}`)
        .limit(5),
    ]);

    const merged: SearchResult[] = [
      ...(clients.data ?? []).map((r) => ({
        type: "client" as const,
        id: r.id,
        label: r.name,
        sub: r.partner_id,
      })),
      ...(products.data ?? []).map((r) => ({
        type: "product" as const,
        id: r.id,
        label: r.name,
        sub: undefined,
      })),
      ...(salespersons.data ?? []).map((r) => ({
        type: "salesperson" as const,
        id: r.id,
        label: r.name,
        sub: r.code,
      })),
    ];

    setResults(merged);
    setLoading(false);
    setOpen(true);
    setActiveIdx(-1);
  }, []);

  useEffect(() => { search(debouncedQ); }, [debouncedQ, search]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const clear = () => {
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const navigate = (result: SearchResult) => {
    setOpen(false);
    setQuery("");
    setResults([]);
    // For clients, use the partner_id (stored in sub) — it's unique, so exactly 1 row shows
    if (result.type === "client")      router.push(`/clients?search=${encodeURIComponent(result.sub ?? result.label)}`);
    if (result.type === "product")     router.push(`/clients?product=${encodeURIComponent(result.label)}`);
    if (result.type === "salesperson") router.push(`/clients?salesperson=${encodeURIComponent(result.id)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, -1)); }
    if (e.key === "Enter" && activeIdx >= 0) navigate(results[activeIdx]);
    if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
  };

  const TypeIcon = ({ type }: { type: SearchResult["type"] }) => {
    if (type === "client")     return <User    className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
    if (type === "product")    return <Package className="h-3.5 w-3.5 text-purple-500 shrink-0" />;
    if (type === "salesperson") return <Users  className="h-3.5 w-3.5 text-green-500 shrink-0" />;
    return null;
  };

  const typeLabel: Record<SearchResult["type"], string> = {
    client:      isRTL ? "عميل"    : "Client",
    product:     isRTL ? "منتج"    : "Product",
    salesperson: isRTL ? "مندوب"   : "Salesperson",
  };

  const grouped = (["client", "product", "salesperson"] as const).filter(
    (t) => results.some((r) => r.type === t)
  );

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md">
      {/* Input */}
      <div className="relative">
        <Search className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10 ${isRTL ? "right-3" : "left-3"}`} />
        {loading && (
          <Loader2 className={`absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin ${isRTL ? "left-3" : "right-3"}`} />
        )}
        {!loading && query && (
          <button
            onClick={clear}
            className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground transition-colors ${isRTL ? "left-3" : "right-3"}`}
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (e.target.value.trim().length >= 2) setOpen(true); else setOpen(false); }}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder={isRTL ? "ابحث عن عملاء، منتجات، مندوبين..." : "Search clients, products, salespersons..."}
          className={`h-9 text-sm ${isRTL ? "pr-9 pl-8" : "pl-9 pr-8"}`}
          autoComplete="off"
        />
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full mt-1 w-full rounded-xl border border-border bg-popover shadow-lg z-50 overflow-hidden">
          {results.length === 0 && !loading && query.trim().length >= 2 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {isRTL ? "لا توجد نتائج" : "No results found"}
            </div>
          ) : (
            <div className="py-1 max-h-[360px] overflow-y-auto">
              {grouped.map((type) => (
                <div key={type}>
                  {/* Group header */}
                  <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50">
                    <TypeIcon type={type} />
                    {typeLabel[type]}
                  </div>
                  {results
                    .filter((r) => r.type === type)
                    .map((result, idx) => {
                      const globalIdx = results.indexOf(result);
                      return (
                        <button
                          key={result.id}
                          className={`w-full text-start flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                            globalIdx === activeIdx ? "bg-accent" : "hover:bg-muted/60"
                          }`}
                          onMouseEnter={() => setActiveIdx(globalIdx)}
                          onClick={() => navigate(result)}
                        >
                          <TypeIcon type={result.type} />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium truncate block">{result.label}</span>
                            {result.sub && (
                              <span className="text-xs text-muted-foreground">{result.sub}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          )}
          {/* Footer hint */}
          {results.length > 0 && (
            <div className="border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground flex items-center gap-3">
              <span>↑↓ {isRTL ? "للتنقل" : "navigate"}</span>
              <span>↵ {isRTL ? "للفتح" : "open"}</span>
              <span>Esc {isRTL ? "للإغلاق" : "close"}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
