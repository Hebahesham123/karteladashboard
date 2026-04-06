/** Customer types shown in filters and included in metrics (all others excluded). */
export const ALLOWED_CUSTOMER_TYPES = ["VIP", "استهلاكي", "تجاري", "جملة"] as const;

export type AllowedCustomerType = (typeof ALLOWED_CUSTOMER_TYPES)[number];

const allowedSet = new Set<string>(ALLOWED_CUSTOMER_TYPES);

export function isAllowedCustomerType(value: string | null | undefined): boolean {
  if (value == null || value === "") return false;
  return allowedSet.has(value.trim());
}

/** Valid filter value, or null if not on the allowlist. */
export function normalizeCustomerTypeFilter(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const t = value.trim();
  return allowedSet.has(t) ? t : null;
}

export function allowedCustomerTypesList(): string[] {
  return [...ALLOWED_CUSTOMER_TYPES];
}
