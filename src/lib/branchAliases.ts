/**
 * Branch name normalization + alias resolution.
 *
 * Uploaded Excels store branches in Arabic with various spellings and notes;
 * scope tables store English canonical names. This module is the single
 * source of truth for matching them up.
 *
 * Aliases must include the EXACT string the orders table contains, because
 * Postgres `IN (...)` and equality compare bytes — see screenshots from
 * `SELECT branch, COUNT(*) FROM orders GROUP BY branch`.
 */

/** Canonical English name → every known variant (including the exact DB strings). */
export const BRANCH_CANONICALS: Record<string, string[]> = {
  "Damietta retail": ["Damietta retail", "Damietta", "فرع دمياط - تجزئة", "فرع دمياط"],
  "Nasr city": ["Nasr city", "Nasr City", "فرع مدينة نصر"],
  "Moskey": ["Moskey", "Mosky", "فرع الموسكى", "فرع الموسكي"],
  "Amal": ["Amal", "El Amal", "فرع الامل", "فرع الأمل"],
  "Faisel": ["Faisel", "Faisal", "فرع فيصل"],
  "Alexandria": ["Alexandria", "فرع الاسكندرية"],
  "Kal3a": ["Kal3a", "Qalaa", "Kalaa", "فرع القلعة"],
  "Helwan": ["Helwan", "فرع حلوان"],
  "Azhar 1": ["Azhar 1", "فرع الازهر 1", "فرع الأزهر 1"],
  "OnLine Branch": ["OnLine Branch", "Online Branch", "اونلاين"],
  "Azhar 2": ["Azhar 2", "فرع الازهر2", "فرع الأزهر2", "فرع الازهر 2"],
  "Hosery": ["Hosery", "فرع الحصرى - اكتوبر", "فرع الحصري - اكتوبر", "فرع الحصرى", "فرع الحصري"],
  "Azhar 3": ["Azhar 3", "فرع الازهر3", "فرع الأزهر3", "فرع الازهر 3"],
  "Southgate": ["Southgate", "South Gate", "فرع ثاوث جيت - التجمع", "فرع ساوث جيت", "ثاوث جيت"],
  "Maadi": ["Maadi", "فرع زهراء المعادي", "فرع زهراء المعادى", "فرع المعادي", "فرع المعادى"],
  "Nozha": ["Nozha", "فرع النزهة"],
  "Tanta": ["Tanta", "فرع طنطا"],
  "Bostan": ["Bostan", "Basateen", "فرع البساتين"],
  "Mini Franchise": ["Mini Franchise Branch", "Mini Franchise"],
  "Mall of arabia": ["Mall of arabia", "Mall of Arabia", "فرع مول العرب"],
  "Mall of egypt": ["Mall of egypt", "Mall of Egypt", "فرع مول مصر"],
  "Madinaty": ["Madinaty", "فرع اير مول - مدينتى", "فرع اير مول - مدينتي", "فرع مدينتى", "فرع مدينتي"],
  "Mivida": ["Mivida", "فرع مافيدا", "فرع مفيدا"],
  "Bostan Wholesale": ["Bostan Wholesale", "فرع البساتين جمله"],
  "Wholesale Showroom": ["Wholesale Showroom", "معارض - جمله"],
  "Wholesale": ["Wholesale", "الجملة"],
  "Mansoura": ["Mansoura", "فرع المنصورة"],
  "The Hub CFC": ["The Hub CFC", "Cairo Festival City", "ذا هاب - كايرو فيستيفال سيتي"],
  "Cutting Point": ["Cutting Point", "نقطة التقطيع"],
  "Trivium zayed": ["Trivium zayed", "Sheikh Zayed", "فرع الشيخ زايد"],
  "Administration": ["Administration", "الادارة"],
  "10th Ramadan Warehouse": ["10th Ramadan Warehouse", "مخزن العاشر - تجزئة"],
  "Showroom": ["Showroom", "فرع معارض"],
  "Tagamoa": ["Tagamoa", "Tagamo3", "التجمع", "فرع التجمع"],
  "Zagazig": ["Zagazig", "الزقازيق", "فرع الزقازيق"],
};

/** Strip Arabic diacritics, normalize letter variants, lowercase, collapse spaces. */
function normalizeText(s: string): string {
  return s
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Reduce any variant to a comparison key. */
export function normalizeBranch(name: string | null | undefined): string {
  if (!name) return "";
  let s = String(name).trim();
  s = s.replace(/^\s*فرع\s+(?:ال)?/, "");
  const dashIdx = s.search(/[-–—]/);
  if (dashIdx >= 0) s = s.slice(0, dashIdx);
  return normalizeText(s);
}

const ALIAS_TO_CANONICAL = ((): Map<string, string> => {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(BRANCH_CANONICALS)) {
    for (const alias of aliases) {
      const key = normalizeBranch(alias);
      if (key && !map.has(key)) map.set(key, canonical);
    }
    const ck = normalizeBranch(canonical);
    if (ck && !map.has(ck)) map.set(ck, canonical);
  }
  return map;
})();

/** Returns the canonical English branch name for any variant, or the original if unknown. */
export function canonicalizeBranch(name: string | null | undefined): string {
  if (!name) return "";
  const key = normalizeBranch(name);
  const hit = ALIAS_TO_CANONICAL.get(key);
  return hit ?? String(name).trim();
}

/** Expand a canonical name into every known DB string (for `branch IN (...)` filters). */
export function expandBranchAliases(canonical: string): string[] {
  const variants = BRANCH_CANONICALS[canonical] ?? [canonical];
  return Array.from(new Set([canonical, ...variants]));
}

/** Expand a list of canonical scope names into the union of all variants. */
export function expandBranchScopeForFilter(scope: string[]): string[] {
  const out = new Set<string>();
  for (const s of scope) {
    if (!s) continue;
    for (const v of expandBranchAliases(s)) out.add(v);
  }
  return Array.from(out);
}
