/** Aligns with DB views: kartela/cartela lines and Arabic كارتل fragment. */
export function isKartelaProductName(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes("kartela") || n.includes("cartela")) return true;
  return name.includes("كارتل");
}

/** Strip common kartela suffixes so "ROCK كارتله" → "ROCK". */
export function stripKartelaSuffix(name: string): string {
  let s = name.trim();
  const lower = s.toLowerCase();
  if (lower.endsWith(" kartela")) return s.slice(0, -7).trim();
  if (lower.endsWith(" cartela")) return s.slice(0, -7).trim();
  if (s.endsWith(" كارتله") || s.endsWith(" كارتلة")) return s.slice(0, -7).trim();
  return s;
}

/** Family key: meter product uses its name; kartela row maps to base fabric name. */
export function kartelaFamilyBaseKey(productName: string): string {
  const t = productName.trim();
  return isKartelaProductName(t) ? stripKartelaSuffix(t) : t;
}
