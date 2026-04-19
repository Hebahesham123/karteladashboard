/** Aligns with DB views: kartela/cartela lines and Arabic كارتل fragment. */
export function isKartelaProductName(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes("kartela") || n.includes("cartela")) return true;
  // Arabic: كارتله/ة، كارتيلا (common in Odoo), كرتيلا typos — substring "كارتل" misses "كارتيلا"
  if (name.includes("كارتل") || name.includes("كارتيلا") || name.includes("كرتيلا")) return true;
  return false;
}

/** Strip common kartela suffixes so "ROCK كارتله" → "ROCK". */
export function stripKartelaSuffix(name: string): string {
  let s = name.trim();
  const lower = s.toLowerCase();
  if (lower.endsWith(" kartela")) return s.slice(0, -7).trim();
  if (lower.endsWith(" cartela")) return s.slice(0, -7).trim();
  if (s.endsWith(" كارتله") || s.endsWith(" كارتلة")) return s.slice(0, -7).trim();
  // Longer Arabic suffixes (كارتيلا etc.)
  if (s.endsWith(" كارتيلا")) return s.slice(0, -7).trim();
  if (s.endsWith(" كرتيلا")) return s.slice(0, -6).trim();
  if (s.endsWith(" كارتيله")) return s.slice(0, -7).trim();
  return s;
}

/** Family key: meter product uses its name; kartela row maps to base fabric name. */
export function kartelaFamilyBaseKey(productName: string): string {
  const t = productName.trim();
  return isKartelaProductName(t) ? stripKartelaSuffix(t) : t;
}

/**
 * Sum meters labeled as kartela/cartela in `meter_breakdown` (when uploads store cartela only there).
 */
export function kartelaMetersFromMeterBreakdown(raw: unknown): number {
  if (!raw || !Array.isArray(raw)) return 0;
  let sum = 0;
  for (const x of raw) {
    const label = String((x as { label?: string; name?: string })?.label ?? (x as { name?: string }).name ?? "").trim();
    const v = Number((x as { meters?: number }).meters) || 0;
    if (v <= 0 || !label) continue;
    if (
      /كارت|كارتيلا|kartela|cartela/i.test(label) ||
      (/color\s*:/i.test(label) && /كارت/i.test(label)) ||
      /كرتون|carton/i.test(label)
    ) {
      sum += v;
    }
  }
  return sum;
}
