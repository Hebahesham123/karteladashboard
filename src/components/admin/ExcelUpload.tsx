"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { motion } from "framer-motion";
import {
  Upload, FileSpreadsheet, CheckCircle, XCircle,
  Loader2, Eye, Zap, AlertTriangle, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/store/useStore";
import { getLevelBadgeColor, getOrderLevel } from "@/lib/utils";

interface ParsedRow {
  date_str: string;
  month: number;
  year: number;
  salesperson_code: string;
  salesperson_name: string;
  partner_name: string;
  partner_id: string;
  product_name: string;
  quantity: number;                  // total meters from color variants
  invoice_total: number;             // sum of invoice amounts for this product+client+month
  customer_type: string;             // e.g. استهلاكي / تجاري / جملة / VIP
  branch: string;                    // branch name
  cartela_qty: number;               // كارتله count (explicit or assumed=1)
  cartela_cross_month: boolean;      // true = كارتله came from a different month
  cartela_assumed: boolean;          // true = no explicit كارتله row, defaulted to 1
  cartela_month: number | null;      // the actual month the كارتله was recorded in
  level: "RED" | "ORANGE" | "GREEN";
  isValid: boolean;
  errors: string[];
  variants: { name: string; meters: number }[]; // color variants combined into total
}

interface UploadResult {
  processed: number;
  failed: number;
  clients: number;
  products: number;
  salespersons: number;
}

const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export function ExcelUpload({ locale }: { locale: string }) {
  const { currentUser } = useStore();
  const isRTL = locale === "ar";
  const months = isRTL ? MONTHS_AR : MONTHS_EN;
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 3 }, (_, i) => currentYear - i);

  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [step, setStep] = useState<"upload" | "preview" | "uploading" | "done">("upload");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const parseExcel = useCallback(async (f: File): Promise<ParsedRow[]> => {
    const XLSX = await import("xlsx");
    const buffer = await f.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
    if (!raw.length) return [];

    // ── Default column positions ──────────────────────────────────────
    // Standard format: A=0 Date  B=1 Salesperson  C=2 PartnerName  D=3 PartnerID
    // E=4 Product  F=5 Quantity(meters)  G=6 Cartons(kartela)
    // Journal Entry format: 0=Date 1=SP 2=Name 3=ID 4=Product 5=Variant 6=Qty 7=CustType 8=Branch 9=Total
    let colDate = 0, colSP = 1, colPartnerName = 2, colPartnerId = 3;
    let colProduct = 4, colVariant = -1, colQty = 5, colCartons = 6;
    let colTotal = -1, colCustomerType = -1, colBranch = -1;
    let startRow = 0;

    // ── Header detection ──────────────────────────────────────────────
    const firstRow = raw[0];
    if (firstRow && typeof firstRow[0] === "string" && isNaN(Number(String(firstRow[0]).trim()))) {
      startRow = 1;
      firstRow.forEach((cell: any, idx: number) => {
        const h = String(cell ?? "").toLowerCase().replace(/[\s/_\-]/g, "");
        if      (h.includes("date") || h.includes("تاريخ") || h.includes("month") || h.includes("شهر"))             colDate        = idx;
        else if (h.includes("salesperson") || h.includes("مندوب"))                                                    colSP          = idx;
        else if ((h.includes("partner") && h.includes("name")) || h.includes("اسمالشريك"))                           colPartnerName = idx;
        else if ((h.includes("partner") && h.includes("id"))   || h.includes("رقمالشريك"))                           colPartnerId   = idx;
        else if (h.includes("attribute") || h.includes("variant"))                                                    colVariant     = idx;
        else if (h.includes("carton") || h.includes("كرتل") || h.includes("كارتل") || h.includes("kartela"))        colCartons     = idx;
        else if (h.includes("quantity") || h.includes("كمية") || h.includes("الكمية") || h.includes("meter") || h.includes("متر")) colQty = idx;
        else if ((h.includes("product") || h.includes("منتج")) &&
                 !h.includes("color") && !h.includes("colour") && !h.includes("لون") &&
                 !h.includes("code")  && !h.includes("كود"))                                                         colProduct     = idx;
        // New: invoice total, customer type, branch
        else if (h.includes("total") || h.includes("إجمالي") || h.includes("المبلغ"))                               colTotal       = idx;
        else if (h.includes("customertype") || h.includes("نوعالعميل") || h.includes("نوع"))                        colCustomerType= idx;
        else if (h.includes("branch") || h.includes("فرع"))                                                          colBranch      = idx;
      });
      // Handle composite headers like "Invoice lines/Total" and "Invoice lines/Partner/Customer Type"
      firstRow.forEach((cell: any, idx: number) => {
        const raw2 = String(cell ?? "").toLowerCase();
        if (raw2.endsWith("/total") || raw2 === "total")                                          colTotal       = idx;
        if (raw2.includes("customer type") || raw2.includes("customertype"))                      colCustomerType= idx;
        if (raw2.includes("branch"))                                                               colBranch      = idx;
        if (raw2.includes("attribute values") || raw2.includes("attribute"))                      colVariant     = idx;
      });
    }

    // ── Auto-detect variant column if not found in header ─────────────
    if (colVariant === -1) {
      const sample = raw.slice(startRow, startRow + 30).filter((r) => r?.length);
      for (let c = 0; c < (sample[0]?.length ?? 10); c++) {
        if (c === colQty || c === colCartons || c === colProduct) continue;
        const vals = sample.map((r) => String(r[c] ?? "").trim()).filter(Boolean);
        if (vals.some((v) => /^COLOR\s*:/i.test(v) || /كارتله|كارتلة/i.test(v))) { colVariant = c; break; }
      }
    }

    // If variant column was found, adjust qty/cartons columns for old format (variant-based)
    if (colVariant >= 0) {
      // Old format: variant in F, qty in G — override defaults
      if (colQty === 5 && colVariant === 5) colQty = 6;
      colCartons = -1; // cartons are inferred from variant text, not a separate column
    }

    // ── Validate product col is text, not numbers ─────────────────────
    const sp5 = raw.slice(startRow, startRow + 5).filter((r) => r?.length);
    const ps  = sp5.map((r) => String(r[colProduct] ?? "").trim());
    if (ps.filter((v) => !isNaN(parseFloat(v)) && v).length > ps.filter((v) => isNaN(parseFloat(v)) && v).length && colProduct > 0) colProduct--;

    // ── Month names for display ───────────────────────────────────────
    const MONTH_NAMES_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
    const MONTH_NAMES_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const monthNames = isRTL ? MONTH_NAMES_AR : MONTH_NAMES_EN;

    // ── Helper: parse date cell → { month, year } ────────────────────
    const parseDate = (val: any): { month: number; year: number } => {
      let d: Date | null = null;
      if (val instanceof Date && !isNaN(val.getTime())) {
        d = val;
      } else {
        const str = String(val ?? "").trim();
        const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) d = new Date(+iso[1], +iso[2] - 1, +iso[3]);
        else {
          const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
          if (dmy) d = new Date(+dmy[3] < 100 ? +dmy[3] + 2000 : +dmy[3], +dmy[2] - 1, +dmy[1]);
          else {
            const num = parseFloat(str);
            if (!isNaN(num) && num > 40000) d = new Date((num - 25569) * 86400 * 1000);
          }
        }
      }
      if (!d || isNaN(d.getTime())) return { month: selectedMonth, year: selectedYear };
      return { month: d.getMonth() + 1, year: d.getFullYear() };
    };

    // ── Helper: clean product name "[008087] FILO (4)" → "FILO" ──────
    const cleanProd = (s: string) => s.replace(/^\[.*?\]\s*/, "").replace(/\s*\(\d+\)\s*$/, "").trim();

    // ── Helper: split salesperson "Name / CODE" or "CODE_Name" ───────
    const parseSP = (s: string) => {
      const slash = s.lastIndexOf("/");
      if (slash !== -1) return { code: s.slice(slash + 1).trim(), name: s.slice(0, slash).trim() };
      const cm = s.match(/^([A-Z]{2,6}\d{3,7})/i);
      if (cm) return { code: cm[1].trim(), name: s.slice(cm[1].length).replace(/^[_\-\s]+/, "").trim() };
      return { code: s, name: s };
    };

    // ── Step 1: Forward-fill blank cells (Date, SP, Client, ID) ──────
    const fillLast: Record<number, any> = {};
    for (let i = startRow; i < raw.length; i++) {
      const row = raw[i];
      if (!row) continue;
      for (const col of [colDate, colSP, colPartnerName, colPartnerId]) {
        const v = row[col];
        const empty = v === null || v === undefined || String(v).trim() === "";
        if (!empty) fillLast[col] = v;
        else if (fillLast[col] !== undefined) row[col] = fillLast[col];
      }
    }

    // ── Step 2: Aggregate by (MONTH × partner × product) ─────────────
    // Groups ALL rows for the same product+client in the same MONTH together,
    // so كارتله rows (even from a different day) merge with color rows.
    interface AggEntry {
      date_str: string; month: number; year: number;
      salesperson_code: string; salesperson_name: string;
      partner_name: string; partner_id: string; product_name: string;
      quantity: number;       // total meters from color variants
      invoice_total: number;  // sum of invoice amounts
      customer_type: string;  // client type (استهلاكي / تجاري / جملة / VIP)
      branch: string;         // branch name
      cartela_qty: number;    // total from explicit كارتله rows
      isValid: boolean; errors: string[];
      variants: { name: string; meters: number }[]; // color variants combined
    }
    const aggMap = new Map<string, AggEntry>();

    for (let i = startRow; i < raw.length; i++) {
      const row = raw[i];
      if (!row || row.every((c: any) => c === null || c === undefined || String(c).trim() === "")) continue;

      const { month, year }  = parseDate(row[colDate]);
      const dateStr          = `${monthNames[month - 1]} ${year}`;
      const spRaw            = String(row[colSP] ?? "").trim();
      const { code: spCode, name: spName } = parseSP(spRaw);
      const partnerName      = String(row[colPartnerName] ?? "").trim();
      const partnerId        = String(row[colPartnerId]   ?? "").trim();
      const baseProduct      = cleanProd(String(row[colProduct] ?? "").trim());
      // New fields: invoice total, customer type, branch
      const rowTotal        = colTotal >= 0 ? (parseFloat(String(row[colTotal] ?? "").replace(/[^\d.]/g, "")) || 0) : 0;
      const rowCustType     = colCustomerType >= 0 ? String(row[colCustomerType] ?? "").trim() : "";
      const rowBranch       = colBranch >= 0 ? String(row[colBranch] ?? "").trim() : "";

      let meters = 0;
      let cartonsCount = 0;
      let variantName = ""; // tracks the color/variant name for breakdown display

      if (colVariant >= 0) {
        // FORMAT A: variant column exists — kartela determined by variant text
        const variantRaw = String(row[colVariant] ?? "").trim();
        const isCartela  = /كارتله|كارتلة|كارتيله|كارتيلة|cartela/i.test(variantRaw);
        let qty = 0;
        for (const c of [colQty, colQty + 1, colQty - 1]) {
          if (c < 0 || c === colProduct || c === colVariant) continue;
          const v = parseFloat(String(row[c] ?? "").replace(/[^\d.]/g, ""));
          if (!isNaN(v) && v > 0) { qty = v; break; }
        }
        if (isCartela) cartonsCount = qty;
        else { meters = qty; variantName = variantRaw; }
      } else {
        // FORMAT B: separate meters (colQty) and cartons (colCartons) columns
        const qVal = parseFloat(String(row[colQty] ?? "").replace(/[^\d.]/g, ""));
        if (!isNaN(qVal) && qVal > 0) meters = qVal;
        if (colCartons >= 0) {
          const cVal = parseFloat(String(row[colCartons] ?? "").replace(/[^\d.]/g, ""));
          if (!isNaN(cVal) && cVal > 0) cartonsCount = cVal;
        }
      }

      if (!baseProduct) continue;

      const aggKey = `${month}|${year}|${partnerId}|${baseProduct}`;

      const errors: string[] = [];
      if (!spCode)      errors.push(isRTL ? "المندوب مطلوب"    : "Salesperson required");
      if (!partnerName) errors.push(isRTL ? "اسم العميل مطلوب" : "Client name required");
      if (!partnerId)   errors.push(isRTL ? "رقم الشريك مطلوب" : "Partner ID required");

      if (aggMap.has(aggKey)) {
        const ex = aggMap.get(aggKey)!;
        ex.quantity      += meters;
        ex.cartela_qty   += cartonsCount;
        ex.invoice_total += rowTotal;
        if (!ex.customer_type && rowCustType) ex.customer_type = rowCustType;
        if (!ex.branch && rowBranch)          ex.branch        = rowBranch;
        if (!ex.salesperson_code && spCode)   { ex.salesperson_code = spCode; ex.salesperson_name = spName; }
        // Track this color variant's contribution
        if (meters > 0 && variantName) ex.variants.push({ name: variantName, meters });
      } else {
        aggMap.set(aggKey, {
          date_str: dateStr, month, year,
          salesperson_code: spCode, salesperson_name: spName,
          partner_name: partnerName, partner_id: partnerId,
          product_name: baseProduct,
          quantity:      meters,
          invoice_total: rowTotal,
          customer_type: rowCustType,
          branch:        rowBranch,
          cartela_qty:   cartonsCount,
          isValid: errors.length === 0, errors,
          variants: meters > 0 && variantName ? [{ name: variantName, meters }] : [],
        });
      }
    }

    // ── Step 3: Build cross-month كارتله lookup ───────────────────────
    // Key: "partnerId|productName"  →  { qty, month, year }
    // So a كارتله taken in April can be linked to meters bought in March
    const crossCartelaMap = new Map<string, { qty: number; month: number; year: number }>();
    for (const entry of Array.from(aggMap.values())) {
      if (entry.cartela_qty > 0) {
        const k = `${entry.partner_id}|${entry.product_name}`;
        const prev = crossCartelaMap.get(k);
        // Keep the most recent / largest کارتله found
        if (!prev || entry.cartela_qty > prev.qty) {
          crossCartelaMap.set(k, { qty: entry.cartela_qty, month: entry.month, year: entry.year });
        }
      }
    }

    // ── Step 4: Finalize ──────────────────────────────────────────────
    return Array.from(aggMap.values() as Iterable<AggEntry>).map((entry) => {
      let cartelaQty        = entry.cartela_qty;
      let cartelaCrossMonth = false;
      let cartelaAssumed    = false;
      let cartelaMonth: number | null = entry.cartela_qty > 0 ? entry.month : null;

      if (cartelaQty === 0) {
        const cross = crossCartelaMap.get(`${entry.partner_id}|${entry.product_name}`);

        if (cross && (cross.month !== entry.month || cross.year !== entry.year)) {
          // Found كارتله in a different month — link for display only, don't re-upload
          cartelaQty        = cross.qty;
          cartelaCrossMonth = true;
          cartelaMonth      = cross.month;
        } else if (entry.quantity > 0) {
          // No explicit كارتله row — default to 1 per product (cartela model assumption)
          cartelaQty    = 1;
          cartelaMonth  = entry.month;
          cartelaAssumed = true;
        }
      }

      return {
        ...entry,
        cartela_qty:         cartelaQty,
        cartela_cross_month: cartelaCrossMonth,
        cartela_assumed:     cartelaAssumed,
        cartela_month:       cartelaMonth,
        level:               getOrderLevel(entry.quantity),
      };
    });
  }, [isRTL, selectedMonth, selectedYear]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const f = acceptedFiles[0];
    if (!f) return;
    setFile(f);
    setErrorMsg("");
    const rows = await parseExcel(f);
    setParsedData(rows);
    setStep("preview");
  }, [parseExcel]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
  });

  const handleUpload = async () => {
    if (!currentUser) return;
    setStep("uploading");
    setProgress(10);
    setErrorMsg("");

    const validRows = parsedData.filter((r) => r.isValid);

    // Expand each ParsedRow into separate meter and كارتله API rows.
    // CROSS-MONTH كارتله: if the كارتله came from a different month, it will be
    // stored when that other month's entry is processed — don't duplicate it here.
    type ApiRow = {
      month: number; year: number; salesperson_code: string; salesperson_name: string;
      partner_name: string; partner_id: string; product_name: string; quantity: number;
      invoice_total: number; customer_type: string; branch: string;
    };
    const apiRows: ApiRow[] = [];
    for (const row of validRows) {
      const base = {
        salesperson_code: row.salesperson_code, salesperson_name: row.salesperson_name,
        partner_name: row.partner_name, partner_id: row.partner_id,
        customer_type: row.customer_type, branch: row.branch,
      };
      // Meters order — in the product's own month
      if (row.quantity > 0) {
        apiRows.push({ ...base, month: row.month, year: row.year, product_name: row.product_name, quantity: row.quantity, invoice_total: row.invoice_total });
      }
      // كارتله order — only EXPLICIT ones (COLOR: كارتلة rows in the Excel).
      // Assumed kartelahs (cartela_assumed=true) are display-only hints and must NOT
      // be stored in the database, otherwise kartela counts become inflated.
      if (row.cartela_qty > 0 && !row.cartela_cross_month && !row.cartela_assumed) {
        const cartelaMonth = row.cartela_month ?? row.month;
        apiRows.push({ ...base, month: cartelaMonth, year: row.year, product_name: `${row.product_name} كارتله`, quantity: row.cartela_qty, invoice_total: 0 });
      }
    }

    try {
      setProgress(30);
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: apiRows,
          month: selectedMonth,
          year: selectedYear,
          userId: currentUser.id,
          filename: file!.name,
        }),
      });
      setProgress(90);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Upload failed");
      setUploadResult(data);
      setProgress(100);
      setStep("done");
    } catch (err: any) {
      setErrorMsg(err.message);
      setStep("preview");
    }
  };

  const reset = () => {
    setFile(null);
    setParsedData([]);
    setStep("upload");
    setUploadResult(null);
    setProgress(0);
    setErrorMsg("");
  };

  const validCount   = parsedData.filter((r) => r.isValid).length;
  const invalidCount = parsedData.filter((r) => !r.isValid).length;
  const cartelaCount = parsedData.filter((r) => r.cartela_qty > 0).length;

  const t = {
    month: isRTL ? "الشهر" : "Month",
    year: isRTL ? "السنة" : "Year",
    dragDrop: isRTL ? "اسحب وأفلت ملف Excel هنا" : "Drag & drop your Excel file here",
    or: isRTL ? "أو" : "or",
    browse: isRTL ? "اختر ملفاً" : "Browse File",
    supports: isRTL ? "يدعم .xlsx و .xls" : "Supports .xlsx and .xls",
    preview: isRTL ? "معاينة البيانات" : "Preview Data",
    valid: isRTL ? "صالح" : "Valid",
    invalid: isRTL ? "خطأ" : "Invalid",
    upload: isRTL ? "رفع البيانات" : "Upload Data",
    uploading: isRTL ? "جارٍ الرفع..." : "Uploading...",
    done: isRTL ? "تم بنجاح!" : "Upload Complete!",
    another: isRTL ? "رفع ملف آخر" : "Upload Another File",
    back: isRTL ? "رجوع" : "Back",
    format: isRTL ? "الصيغة المطلوبة" : "Required Format",
    col: isRTL ? "العمود" : "Column",
    example: isRTL ? "مثال" : "Example",
  };

  // Unique months found in parsed data
  const detectedMonths = Array.from(new Set(parsedData.map((r) => r.month))).sort((a, b) => a - b);

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Year selector only — month is read from Excel column A */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">{t.year}:</label>
          <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(+v)}>
            <SelectTrigger className="w-24 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Month info pill — shows months read from Excel */}
        {detectedMonths.length > 0 ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200 text-blue-700 dark:text-blue-400 text-xs font-medium">
            <CheckCircle className="h-3.5 w-3.5" />
            {isRTL ? "الأشهر من الملف:" : "Months from file:"}{" "}
            {detectedMonths.map((m) => months[m - 1]).join(", ")}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted border border-border text-muted-foreground text-xs font-medium">
            <Eye className="h-3.5 w-3.5" />
            {isRTL ? "الشهر يُقرأ من العمود A تلقائياً" : "Month is read from column A automatically"}
          </div>
        )}

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 dark:bg-green-950/30 border border-green-200 text-green-700 dark:text-green-400 text-xs font-medium">
          <Zap className="h-3.5 w-3.5" />
          {isRTL ? "رفع سريع بالدُفعات" : "Fast batch upload"}
        </div>
      </div>

      {/* STEP: Upload */}
      {step === "upload" && (
        <div className="space-y-4">
          <div
            {...getRootProps()}
            className={`relative border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer transition-all duration-200 ${
              isDragActive ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/60 hover:bg-muted/30"
            }`}
          >
            <input {...getInputProps()} />
            <FileSpreadsheet className="h-14 w-14 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-semibold">{t.dragDrop}</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">{t.or}</p>
            <Button variant="outline" type="button">
              <Upload className="h-4 w-4" /> {t.browse}
            </Button>
            <p className="text-xs text-muted-foreground mt-4">{t.supports}</p>
          </div>

          {/* Format guide */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Eye className="h-4 w-4" />{t.format}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {["A","B","C","D","E","F","G"].map((col) => (
                        <th key={col} className="px-3 py-2 text-start font-bold text-muted-foreground">{col}</th>
                      ))}
                    </tr>
                    <tr className="border-t border-border">
                      {[
                        isRTL?"الشهر":"month",
                        isRTL?"المندوب":"Salesperson",
                        isRTL?"اسم الشريك":"Partner/Name",
                        isRTL?"رقم الشريك":"Partner/ID",
                        isRTL?"المنتج":"Product/Name",
                        isRTL?"الكمية (متر)":"Quantity",
                        isRTL?"الكرتلات":"Cartons",
                      ].map((h) => (
                        <th key={h} className="px-3 py-2 text-start font-semibold text-muted-foreground/70 text-[10px] uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-border">
                      {["3","أمير مصطفى / NSR1596","مكتب كوزي","888551","HERO","27","1"].map((v, i) => (
                        <td key={i} className="px-3 py-2 text-muted-foreground">{v}</td>
                      ))}
                    </tr>
                    <tr className="border-t border-border bg-muted/20">
                      {["3","محمد شبان / NSR3350","معرض المركز","840493","RALPH","12","1"].map((v, i) => (
                        <td key={i} className="px-3 py-2 text-muted-foreground">{v}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP: Preview */}
      {step === "preview" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Stats bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted border border-border text-sm font-medium">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              {file?.name}
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200 text-blue-700 text-sm font-medium">
              <BarChart3 className="h-4 w-4" />
              {parsedData.length} {isRTL ? "صف" : "rows"}
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 dark:bg-green-950/30 border border-green-200 text-green-700 text-sm font-medium">
              <CheckCircle className="h-4 w-4" />
              {validCount} {t.valid}
            </div>
            {cartelaCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-50 dark:bg-purple-950/30 border border-purple-200 text-purple-700 dark:text-purple-400 text-sm font-medium">
                <span className="text-xs font-bold">كارتله</span>
                {cartelaCount} {isRTL ? "كارتلات" : "cartelahs"}
              </div>
            )}
            {invalidCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 dark:bg-red-950/30 border border-red-200 text-red-700 text-sm font-medium">
                <XCircle className="h-4 w-4" />
                {invalidCount} {t.invalid}
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {errorMsg}
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground px-1">
            <span className="font-semibold">{isRTL ? "دليل الألوان:" : "Color guide:"}</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-green-500" />{isRTL ? "جيد ≥100م" : "Healthy ≥100m"}</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-orange-500" />{isRTL ? "منخفض 1–99م" : "Low 1–99m"}</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-red-500" />{isRTL ? "بدون طلبات" : "No orders"}</span>
            <span className="flex items-center gap-1"><span className="inline-block px-2 py-0.5 rounded-full bg-purple-100 border border-purple-300 text-purple-700 font-bold text-[10px]">1</span>{isRTL ? "كارتله صريح" : "Explicit cartela"}</span>
            <span className="flex items-center gap-1"><span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 border border-slate-300 text-slate-600 font-bold text-[10px]">1</span>{isRTL ? "كارتله افتراضي (لا يوجد في الملف)" : "Assumed cartela (not in file)"}</span>
            <span className="flex items-center gap-1"><span className="inline-block px-2 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-700 font-bold text-[10px]">1</span>{isRTL ? "كارتله من شهر آخر" : "Cartela from different month"}</span>
          </div>

          {/* Preview table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[400px] scrollbar-thin">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm z-10">
                    <tr>
                      {[
                        "#",
                        isRTL ? "التاريخ"       : "Date",
                        isRTL ? "الحالة"        : "Level",
                        isRTL ? "اسم العميل"    : "Client",
                        isRTL ? "رقم الشريك"    : "Partner ID",
                        isRTL ? "المنتج"        : "Product",
                        isRTL ? "الأمتار (م)"   : "Meters (m)",
                        isRTL ? "الإجمالي"      : "Total (EGP)",
                        isRTL ? "نوع العميل"    : "Cust. Type",
                        isRTL ? "كارتله"        : "Cartelah",
                        isRTL ? "المندوب"       : "Salesperson",
                      ].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-start font-semibold text-muted-foreground border-b border-border whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.map((row, i) => (
                      <tr key={i} className={`border-b border-border/40 transition-colors ${!row.isValid ? "bg-red-50/50 dark:bg-red-950/10" : i % 2 === 0 ? "" : "bg-muted/20"}`}>
                        <td className="px-3 py-2 text-muted-foreground text-xs">{i + 1}</td>
                        {/* Date */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted border border-border text-xs font-semibold">
                            {row.date_str}
                          </span>
                        </td>
                        {/* Level */}
                        <td className="px-3 py-2">
                          {row.isValid ? (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold border text-xs ${getLevelBadgeColor(row.level)}`}>
                              <span className="h-1.5 w-1.5 rounded-full bg-current" />
                              {row.level}
                            </span>
                          ) : (
                            <span className="text-red-500 text-[10px]">{row.errors[0]}</span>
                          )}
                        </td>
                        {/* Client */}
                        <td className="px-3 py-2 font-medium max-w-[180px] truncate">{row.partner_name || <span className="text-red-400 text-[10px]">—</span>}</td>
                        {/* Partner ID */}
                        <td className="px-3 py-2 font-mono text-sm font-semibold">{row.partner_id}</td>
                        {/* Product */}
                        <td className="px-3 py-2 font-medium">{row.product_name}</td>
                        {/* Meters — with variant breakdown if multiple colors combined */}
                        <td className="px-3 py-2 font-bold text-blue-600 dark:text-blue-400">
                          {row.quantity > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              <span>{row.quantity.toLocaleString()}m</span>
                              {row.variants.length > 1 && (
                                <span className="text-[9px] text-muted-foreground font-normal leading-tight max-w-[160px]">
                                  {row.variants.map((v) => `${v.name}: ${v.meters}m`).join(" + ")}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        {/* Invoice Total */}
                        <td className="px-3 py-2 font-semibold text-green-700 dark:text-green-400 tabular-nums">
                          {row.invoice_total > 0
                            ? row.invoice_total.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        {/* Customer Type */}
                        <td className="px-3 py-2">
                          {row.customer_type ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-700">
                              {row.customer_type}
                            </span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        {/* كارتله qty — with cross-month & assumed indicators */}
                        <td className="px-3 py-2">
                          {row.cartela_qty > 0 ? (
                            <div className="flex flex-col gap-0.5 items-start">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-xs border ${
                                row.cartela_cross_month
                                  ? "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700"
                                  : row.cartela_assumed
                                  ? "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400"
                                  : "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-700"
                              }`}>
                                {row.cartela_qty}
                              </span>
                              {row.cartela_cross_month && row.cartela_month && (
                                <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium">
                                  {isRTL ? `من ${months[row.cartela_month - 1]}` : `from ${months[row.cartela_month - 1]}`}
                                </span>
                              )}
                              {row.cartela_assumed && (
                                <span className="text-[9px] text-slate-500 font-medium">
                                  {isRTL ? "افتراضي" : "assumed"}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        {/* Salesperson */}
                        <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px] text-xs">{row.salesperson_name || row.salesperson_code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={reset}>{t.back}</Button>
            <Button onClick={handleUpload} disabled={validCount === 0} className="gap-2 flex-1 sm:flex-none">
              <Zap className="h-4 w-4" />
              {t.upload} ({validCount} {isRTL ? "منتج" : "products"})
            </Button>
          </div>
        </motion.div>
      )}

      {/* STEP: Uploading */}
      {step === "uploading" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-20 flex flex-col items-center gap-6">
          <div className="relative">
            <div className="h-20 w-20 rounded-full border-4 border-muted flex items-center justify-center">
              <Loader2 className="h-9 w-9 text-primary animate-spin" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold">{t.uploading}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {isRTL ? `جارٍ معالجة ${validCount} صف دفعةً واحدة...` : `Processing ${validCount} rows in one batch...`}
            </p>
          </div>
          {/* Progress bar */}
          <div className="w-full max-w-xs h-2 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: "10%" }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <p className="text-sm font-medium text-primary">{progress}%</p>
        </motion.div>
      )}

      {/* STEP: Done */}
      {step === "done" && uploadResult && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="py-12 flex flex-col items-center gap-6"
        >
          <div className="h-20 w-20 rounded-full bg-green-100 dark:bg-green-950/30 flex items-center justify-center">
            <CheckCircle className="h-10 w-10 text-green-500" />
          </div>
          <div className="text-center">
            <h3 className="text-2xl font-bold">{t.done}</h3>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-lg">
            {[
              { label: isRTL ? "طلبات" : "Orders", value: uploadResult.processed, color: "text-blue-600" },
              { label: isRTL ? "عملاء" : "Clients", value: uploadResult.clients, color: "text-purple-600" },
              { label: isRTL ? "منتجات" : "Products", value: uploadResult.products, color: "text-green-600" },
              { label: isRTL ? "مندوبون" : "Salespeople", value: uploadResult.salespersons, color: "text-orange-600" },
            ].map((stat) => (
              <div key={stat.label} className="p-4 rounded-xl border border-border bg-muted/30 text-center">
                <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          {uploadResult.failed > 0 && (
            <div className="space-y-1 text-sm text-center max-w-sm">
              <p className="text-orange-600 font-medium">
                ⚠️ {uploadResult.failed} {isRTL ? "صف فشل في المعالجة" : "rows failed to process"}
              </p>
              {(uploadResult as any).debug?.firstDbError && (
                <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded px-3 py-1">
                  DB: {(uploadResult as any).debug.firstDbError}
                </p>
              )}
              {(uploadResult as any).debug?.failReasons && Object.keys((uploadResult as any).debug.failReasons).length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {JSON.stringify((uploadResult as any).debug.failReasons)}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={reset}>{t.another}</Button>
            <a href="/dashboard"><Button>{isRTL ? "عرض لوحة التحكم" : "View Dashboard"}</Button></a>
          </div>
        </motion.div>
      )}
    </div>
  );
}
