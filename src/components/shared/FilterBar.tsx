"use client";

import { useEffect, useState } from "react";
import { Filter, X, ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStore } from "@/store/useStore";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  locale: string;
  showSalesperson?: boolean;
  showClient?: boolean;
  showStatus?: boolean;
  showLevel?: boolean;
  showProduct?: boolean;
  multiSelectDropdowns?: boolean;
  /** Extra controls shown only in the mobile filter dialog (e.g. clients product + type) */
  mobileDrawerExtra?: React.ReactNode;
}

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function FilterBar({
  locale,
  showSalesperson = true,
  showClient = false,
  showStatus = false,
  showLevel = false,
  showProduct = false,
  multiSelectDropdowns = false,
  mobileDrawerExtra,
}: FilterBarProps) {
  const { filters, setFilter } = useStore();
  const [salespersons, setSalespersons] = useState<{ id: string; name: string }[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string; partner_id: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [spOpen, setSpOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isRTL = locale === "ar";

  const months = isRTL ? MONTHS_AR : MONTHS_EN;
  const now = new Date();
  const currentMonthNum = now.getMonth() === 0 ? 12 : now.getMonth();
  const currentYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  useEffect(() => {
    if (!filters.selectedMonth) setFilter("selectedMonth", currentMonthNum);
    if (!filters.selectedYear) setFilter("selectedYear", currentYear);
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
      if (showClient) {
        const { data } = await supabase
          .from("clients")
          .select("id, name, partner_id")
          .order("name");
        setClients(data || []);
      }
    };
    fetchOptions();
  }, [showSalesperson, showProduct, showClient]);

  const statuses = [
    { value: "NEW", label: isRTL ? "جديد" : "New" },
    { value: "FOLLOW_UP_1", label: isRTL ? "متابعة 1" : "Follow Up 1" },
    { value: "FOLLOW_UP_2", label: isRTL ? "متابعة 2" : "Follow Up 2" },
    { value: "RECOVERED", label: isRTL ? "مستعاد" : "Recovered" },
    { value: "LOST", label: isRTL ? "مفقود" : "Lost" },
    { value: "CANCELLED", label: isRTL ? "ملغى" : "Cancelled" },
  ];

  const levels = [
    { value: "GREEN", label: isRTL ? "طلبات أكثر من 100م" : "Orders ≥ 100m" },
    { value: "ORANGE", label: isRTL ? "طلبات أقل من 100م" : "Orders < 100m" },
    { value: "RED", label: isRTL ? "كارتيلا فقط — بدون أمتار" : "Cartela Only – No Meters" },
    { value: "INACTIVE", label: isRTL ? "لم يطلب هذا الشهر" : "No Orders This Month" },
  ];

  const handleReset = () => {
    setFilter("selectedSalesperson", null);
    setFilter("selectedSalespersons", []);
    setFilter("selectedClient", null);
    setFilter("selectedClients", []);
    setFilter("selectedStatus", null);
    setFilter("selectedLevel", null);
    setFilter("selectedProduct", null);
    setFilter("selectedProducts", []);
    setFilter("selectedMonth", currentMonthNum);
    setFilter("selectedYear", currentYear);
  };
  const selectedSalespersons = filters.selectedSalespersons ?? [];
  const selectedClients = filters.selectedClients ?? [];
  const selectedProducts = filters.selectedProducts ?? [];

  const hasActiveFilters =
    filters.selectedSalesperson !== null ||
    selectedSalespersons.length > 0 ||
    filters.selectedClient !== null ||
    selectedClients.length > 0 ||
    filters.selectedStatus !== null ||
    filters.selectedLevel !== null ||
    filters.selectedProduct !== null ||
    selectedProducts.length > 0 ||
    filters.selectedMonth !== currentMonthNum ||
    filters.selectedYear !== currentYear;

  const monthDisplayValue = (filters.selectedMonth ?? currentMonthNum).toString();
  const yearDisplayValue = (filters.selectedYear ?? currentYear).toString();

  const activeCount =
    [
      filters.selectedSalesperson,
      ...selectedSalespersons,
      filters.selectedClient,
      ...selectedClients,
      filters.selectedStatus,
      filters.selectedLevel,
      filters.selectedProduct,
      ...selectedProducts,
    ].filter(Boolean).length +
    (filters.selectedMonth !== currentMonthNum || filters.selectedYear !== currentYear ? 1 : 0);

  const toggleId = (current: string[], id: string) =>
    current.includes(id) ? current.filter((x) => x !== id) : [...current, id];

  const triggerSm = "h-7 text-[10px] px-2 md:h-8 md:text-xs";
  const triggerMd = "w-36 h-8 text-xs";
  const triggerWFull = "w-full h-9 text-xs justify-between font-normal";

  const filterFields = (stack: boolean) => (
    <div className={cn(stack ? "flex flex-col gap-3" : "flex items-center gap-3 flex-wrap")}>
      {!stack && (
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Filter className="h-4 w-4" />
          <span>{isRTL ? "تصفية:" : "Filter:"}</span>
        </div>
      )}

      <Select value={monthDisplayValue} onValueChange={(v) => setFilter("selectedMonth", parseInt(v))}>
        <SelectTrigger className={stack ? triggerWFull : cn("w-28 md:w-36", triggerSm)}>
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

      <Select value={yearDisplayValue} onValueChange={(v) => setFilter("selectedYear", parseInt(v))}>
        <SelectTrigger className={stack ? triggerWFull : cn("w-24 md:w-28", triggerSm)}>
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

      {showSalesperson && salespersons.length > 0 && (
        <Popover open={spOpen} onOpenChange={setSpOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={spOpen}
              className={stack ? triggerWFull : cn("w-44 md:w-52", triggerSm)}
            >
              <span className="truncate">
                {multiSelectDropdowns
                  ? (selectedSalespersons.length > 0
                      ? `${selectedSalespersons.length} ${isRTL ? "مختار" : "selected"}`
                      : isRTL ? "كل المندوبين" : "All Salespersons")
                  : (filters.selectedSalesperson
                      ? salespersons.find((sp) => sp.id === filters.selectedSalesperson)?.name
                      : isRTL ? "كل المندوبين" : "All Salespersons")}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ms-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(100vw-2rem,22rem)] p-0" align="start">
            <Command>
              <CommandInput placeholder={isRTL ? "ابحث عن مندوب..." : "Search salesperson..."} className="text-xs h-8" />
              <CommandList>
                <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
                  {isRTL ? "لا توجد نتائج" : "No results found"}
                </CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="all"
                    onSelect={() => {
                      if (multiSelectDropdowns) setFilter("selectedSalespersons", []);
                      else {
                        setFilter("selectedSalesperson", null);
                        setSpOpen(false);
                      }
                    }}
                    className="text-xs"
                  >
                    <Check className={`h-3.5 w-3.5 mr-2 ${
                      multiSelectDropdowns
                        ? (selectedSalespersons.length === 0 ? "opacity-100" : "opacity-0")
                        : (!filters.selectedSalesperson ? "opacity-100" : "opacity-0")
                    }`} />
                    {isRTL ? "كل المندوبين" : "All Salespersons"}
                  </CommandItem>
                  {salespersons.map((sp) => (
                    <CommandItem
                      key={sp.id}
                      value={sp.name}
                      onSelect={() => {
                        if (multiSelectDropdowns) setFilter("selectedSalespersons", toggleId(selectedSalespersons, sp.id));
                        else {
                          setFilter("selectedSalesperson", filters.selectedSalesperson === sp.id ? null : sp.id);
                          setSpOpen(false);
                        }
                      }}
                      className="text-xs"
                    >
                      <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${
                        multiSelectDropdowns
                          ? (selectedSalespersons.includes(sp.id) ? "opacity-100" : "opacity-0")
                          : (filters.selectedSalesperson === sp.id ? "opacity-100" : "opacity-0")
                      }`} />
                      <span className="truncate">{sp.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {showStatus && (
        <Select value={filters.selectedStatus || "all"} onValueChange={(v) => setFilter("selectedStatus", v === "all" ? null : v)}>
          <SelectTrigger className={stack ? triggerWFull : triggerMd}>
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

      {showLevel && (
        <Select value={filters.selectedLevel || "all"} onValueChange={(v) => setFilter("selectedLevel", v === "all" ? null : v)}>
          <SelectTrigger className={stack ? triggerWFull : triggerMd}>
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

      {showProduct && products.length > 0 && (
        multiSelectDropdowns ? (
          <Popover open={productOpen} onOpenChange={setProductOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={productOpen} className={stack ? triggerWFull : triggerMd}>
                <span className="truncate">
                  {selectedProducts.length > 0
                    ? `${selectedProducts.length} ${isRTL ? "مختار" : "selected"}`
                    : isRTL ? "كل المنتجات" : "All Products"}
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ms-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(100vw-2rem,24rem)] p-0" align="start">
              <Command>
                <CommandInput placeholder={isRTL ? "ابحث عن منتج..." : "Search product..."} className="text-xs h-8" />
                <CommandList>
                  <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
                    {isRTL ? "لا توجد نتائج" : "No results found"}
                  </CommandEmpty>
                  <CommandGroup>
                    <CommandItem value="all" onSelect={() => setFilter("selectedProducts", [])} className="text-xs">
                      <Check className={`h-3.5 w-3.5 mr-2 ${selectedProducts.length === 0 ? "opacity-100" : "opacity-0"}`} />
                      {isRTL ? "كل المنتجات" : "All Products"}
                    </CommandItem>
                    {products.map((p) => (
                      <CommandItem key={p.id} value={p.name} onSelect={() => setFilter("selectedProducts", toggleId(selectedProducts, p.id))} className="text-xs">
                        <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${selectedProducts.includes(p.id) ? "opacity-100" : "opacity-0"}`} />
                        <span className="truncate">{p.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          <Select value={filters.selectedProduct || "all"} onValueChange={(v) => setFilter("selectedProduct", v === "all" ? null : v)}>
            <SelectTrigger className={stack ? triggerWFull : triggerMd}>
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
        )
      )}

      {showClient && clients.length > 0 && (
        multiSelectDropdowns ? (
          <Popover open={clientOpen} onOpenChange={setClientOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={clientOpen} className={stack ? triggerWFull : cn("w-44 md:w-52", triggerSm)}>
                <span className="truncate">
                  {selectedClients.length > 0
                    ? `${selectedClients.length} ${isRTL ? "مختار" : "selected"}`
                    : isRTL ? "كل العملاء" : "All Clients"}
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ms-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(100vw-2rem,24rem)] p-0" align="start">
              <Command>
                <CommandInput placeholder={isRTL ? "ابحث عن عميل..." : "Search client..."} className="text-xs h-8" />
                <CommandList>
                  <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
                    {isRTL ? "لا توجد نتائج" : "No results found"}
                  </CommandEmpty>
                  <CommandGroup>
                    <CommandItem value="all" onSelect={() => setFilter("selectedClients", [])} className="text-xs">
                      <Check className={`h-3.5 w-3.5 mr-2 ${selectedClients.length === 0 ? "opacity-100" : "opacity-0"}`} />
                      {isRTL ? "كل العملاء" : "All Clients"}
                    </CommandItem>
                    {clients.map((c) => (
                      <CommandItem key={c.id} value={`${c.name} ${c.partner_id}`} onSelect={() => setFilter("selectedClients", toggleId(selectedClients, c.id))} className="text-xs">
                        <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${selectedClients.includes(c.id) ? "opacity-100" : "opacity-0"}`} />
                        <span className="truncate">{c.name} ({c.partner_id})</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          <Select value={filters.selectedClient || "all"} onValueChange={(v) => setFilter("selectedClient", v === "all" ? null : v)}>
            <SelectTrigger className={stack ? triggerWFull : cn("w-44 md:w-52", triggerSm)}>
              <SelectValue placeholder={isRTL ? "العميل" : "Client"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isRTL ? "كل العملاء" : "All Clients"}</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ({c.partner_id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      )}

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className={cn("h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground", stack && "w-full justify-center")}
        >
          <X className="h-3.5 w-3.5" />
          {isRTL ? "مسح الكل" : "Clear all"}
        </Button>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop / tablet toolbar */}
      <div className="hidden md:block rounded-xl border border-border bg-card/50 px-3 py-2">
        {filterFields(false)}
      </div>

      {/* Mobile: quick month/year + full filters in dialog */}
      <div className="md:hidden space-y-2">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 px-2" onClick={() => setMobileOpen(true)}>
            <Filter className="h-3.5 w-3.5" />
            {isRTL ? "تصفية" : "Filters"}
            {activeCount > 0 && (
              <Badge variant="secondary" className="h-5 min-w-5 px-1 text-[10px] tabular-nums">
                {activeCount}
              </Badge>
            )}
          </Button>
          <Select value={monthDisplayValue} onValueChange={(v) => setFilter("selectedMonth", parseInt(v))}>
            <SelectTrigger className="h-8 flex-1 min-w-0 text-[10px] px-2">
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
          <Select value={yearDisplayValue} onValueChange={(v) => setFilter("selectedYear", parseInt(v))}>
            <SelectTrigger className="h-8 w-[4.25rem] shrink-0 text-[10px] px-1.5">
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
        </div>

        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogContent
            className={cn(
              "z-[60] max-h-[min(90vh,640px)] w-[min(100vw-1rem,24rem)] gap-3 p-4 pt-5",
              isRTL && "[&>button]:left-4 [&>button]:right-auto"
            )}
          >
            <DialogHeader>
              <DialogTitle className="text-base">{isRTL ? "تصفية العملاء" : "Filter clients"}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[min(75vh,520px)] overflow-y-auto pe-1">
              {filterFields(true)}
              {mobileDrawerExtra && <div className="mt-4 space-y-3 border-t border-border pt-3">{mobileDrawerExtra}</div>}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
