"use client";

import { useEffect, useState } from "react";
import { Filter, X, ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useStore } from "@/store/useStore";
import { createClient } from "@/lib/supabase/client";

interface FilterBarProps {
  locale: string;
  showSalesperson?: boolean;
  showStatus?: boolean;
  showLevel?: boolean;
  showProduct?: boolean;
}

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function FilterBar({
  locale,
  showSalesperson = true,
  showStatus = false,
  showLevel = false,
  showProduct = false,
}: FilterBarProps) {
  const { filters, setFilter, resetFilters } = useStore();
  const [salespersons, setSalespersons] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [spOpen, setSpOpen] = useState(false);
  const isRTL = locale === "ar";

  const months = isRTL ? MONTHS_AR : MONTHS_EN;
  const now = new Date();
  const currentMonthNum = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  // Always ensure a month/year is selected (never null)
  useEffect(() => {
    if (!filters.selectedMonth) setFilter("selectedMonth", currentMonthNum);
    if (!filters.selectedYear)  setFilter("selectedYear",  currentYear);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const fetchOptions = async () => {
      const supabase = createClient();
      if (showSalesperson) {
        const { data } = await supabase
          .from("salespersons")
          .select("id, name")
          .eq("is_active", true)
          .order("name");
        setSalespersons(data || []);
      }
      if (showProduct) {
        const { data } = await supabase
          .from("products")
          .select("id, name")
          .eq("is_active", true)
          .order("name");
        setProducts(data || []);
      }
    };
    fetchOptions();
  }, [showSalesperson, showProduct]);

  const statuses = [
    { value: "NEW",         label: isRTL ? "جديد"      : "New" },
    { value: "FOLLOW_UP_1", label: isRTL ? "متابعة 1"  : "Follow Up 1" },
    { value: "FOLLOW_UP_2", label: isRTL ? "متابعة 2"  : "Follow Up 2" },
    { value: "RECOVERED",   label: isRTL ? "مستعاد"    : "Recovered" },
    { value: "LOST",        label: isRTL ? "مفقود"     : "Lost" },
    { value: "CANCELLED",   label: isRTL ? "ملغى"      : "Cancelled" },
  ];

  const levels = [
    { value: "GREEN",    label: isRTL ? "طلبات أكثر من 100م"          : "Orders ≥ 100m" },
    { value: "ORANGE",   label: isRTL ? "طلبات أقل من 100م"           : "Orders < 100m" },
    { value: "RED",      label: isRTL ? "كارتيلا فقط — بدون أمتار"    : "Cartela Only – No Meters" },
    { value: "INACTIVE", label: isRTL ? "لم يطلب هذا الشهر"           : "No Orders This Month" },
  ];

  const handleReset = () => {
    setFilter("selectedSalesperson", null);
    setFilter("selectedStatus",      null);
    setFilter("selectedLevel",       null);
    setFilter("selectedProduct",     null);
    setFilter("selectedMonth",       currentMonthNum);
    setFilter("selectedYear",        currentYear);
  };

  const hasActiveFilters =
    filters.selectedSalesperson !== null ||
    filters.selectedStatus      !== null ||
    filters.selectedLevel       !== null ||
    filters.selectedProduct     !== null ||
    filters.selectedMonth !== currentMonthNum ||
    filters.selectedYear  !== currentYear;

  // Display value: fall back to current month/year if store has null
  const monthDisplayValue = (filters.selectedMonth ?? currentMonthNum).toString();
  const yearDisplayValue  = (filters.selectedYear  ?? currentYear).toString();

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Filter className="h-4 w-4" />
        <span>{isRTL ? "تصفية:" : "Filter:"}</span>
      </div>

      {/* Month — "All Months" removed; a specific month is always required */}
      <Select
        value={monthDisplayValue}
        onValueChange={(v) => setFilter("selectedMonth", parseInt(v))}
      >
        <SelectTrigger className="w-36 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((month, i) => (
            <SelectItem key={i + 1} value={(i + 1).toString()}>
              {month}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Year — "All Years" removed */}
      <Select
        value={yearDisplayValue}
        onValueChange={(v) => setFilter("selectedYear", parseInt(v))}
      >
        <SelectTrigger className="w-28 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((year) => (
            <SelectItem key={year} value={year.toString()}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Salesperson — searchable combobox */}
      {showSalesperson && salespersons.length > 0 && (
        <Popover open={spOpen} onOpenChange={setSpOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={spOpen}
              className="w-52 h-8 text-xs justify-between font-normal"
            >
              <span className="truncate">
                {filters.selectedSalesperson
                  ? salespersons.find((sp) => sp.id === filters.selectedSalesperson)?.name
                  : isRTL ? "كل المندوبين" : "All Salespersons"}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command>
              <CommandInput
                placeholder={isRTL ? "ابحث عن مندوب..." : "Search salesperson..."}
                className="text-xs h-8"
              />
              <CommandList>
                <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
                  {isRTL ? "لا توجد نتائج" : "No results found"}
                </CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="all"
                    onSelect={() => { setFilter("selectedSalesperson", null); setSpOpen(false); }}
                    className="text-xs"
                  >
                    <Check className={`h-3.5 w-3.5 mr-2 ${!filters.selectedSalesperson ? "opacity-100" : "opacity-0"}`} />
                    {isRTL ? "كل المندوبين" : "All Salespersons"}
                  </CommandItem>
                  {salespersons.map((sp) => (
                    <CommandItem
                      key={sp.id}
                      value={sp.name}
                      onSelect={() => {
                        setFilter("selectedSalesperson", filters.selectedSalesperson === sp.id ? null : sp.id);
                        setSpOpen(false);
                      }}
                      className="text-xs"
                    >
                      <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${filters.selectedSalesperson === sp.id ? "opacity-100" : "opacity-0"}`} />
                      <span className="truncate">{sp.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {/* Status */}
      {showStatus && (
        <Select
          value={filters.selectedStatus || "all"}
          onValueChange={(v) => setFilter("selectedStatus", v === "all" ? null : v)}
        >
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder={isRTL ? "الحالة" : "Status"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isRTL ? "كل الحالات" : "All Statuses"}</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Level */}
      {showLevel && (
        <Select
          value={filters.selectedLevel || "all"}
          onValueChange={(v) => setFilter("selectedLevel", v === "all" ? null : v)}
        >
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder={isRTL ? "المستوى" : "Level"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isRTL ? "كل المستويات" : "All Levels"}</SelectItem>
            {levels.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Product */}
      {showProduct && products.length > 0 && (
        <Select
          value={filters.selectedProduct || "all"}
          onValueChange={(v) => setFilter("selectedProduct", v === "all" ? null : v)}
        >
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder={isRTL ? "المنتج" : "Product"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isRTL ? "كل المنتجات" : "All Products"}</SelectItem>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Clear filters */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          {isRTL ? "مسح" : "Clear"}
        </Button>
      )}
    </div>
  );
}
