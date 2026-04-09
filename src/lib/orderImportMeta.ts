import type { SupabaseClient } from "@supabase/supabase-js";
import { isKartelaProductName } from "@/lib/kartelaProduct";

function productNameFromJoin(row: { products?: unknown }): string | null {
  const p = row.products as { name?: string } | { name?: string }[] | null | undefined;
  if (!p) return null;
  if (Array.isArray(p)) return String(p[0]?.name ?? "").trim() || null;
  return String(p.name ?? "").trim() || null;
}

export type DistinctOrderFiltersOptions = {
  pageSize?: number;
  maxPages?: number;
  /** When set with year, only scan orders in this month (recommended — old rows often have null category). */
  month?: number;
  year?: number;
};

const sortLocale = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** Page through orders to collect distinct non-empty category / pricelist. */
export async function fetchDistinctCategoriesAndPricelists(
  supabase: SupabaseClient,
  options?: DistinctOrderFiltersOptions
): Promise<{ categories: string[]; pricelists: string[]; error: string | null }> {
  const pageSize = options?.pageSize ?? 1000;
  const maxPages = options?.maxPages ?? 500;
  const catSet = new Set<string>();
  const plSet = new Set<string>();
  let from = 0;
  let lastError: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    let q = supabase.from("orders").select("category, pricelist").order("id", { ascending: true });

    if (options?.month != null && options?.year != null) {
      q = q.eq("month", options.month).eq("year", options.year);
    }

    const { data, error } = await q.range(from, from + pageSize - 1);

    if (error) {
      lastError = error.message;
      break;
    }
    if (!data?.length) break;

    for (const r of data as { category?: string | null; pricelist?: string | null }[]) {
      const c = String(r.category ?? "").trim();
      if (c) catSet.add(c);
      const pl = String(r.pricelist ?? "").trim();
      if (pl) plSet.add(pl);
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return {
    categories: Array.from(catSet).sort(sortLocale),
    pricelists: Array.from(plSet).sort(sortLocale),
    error: lastError,
  };
}

/** Distinct category/pricelist for orders in month/year belonging to given clients (paginated per client batch). */
export async function fetchDistinctFromOrdersForClients(
  supabase: SupabaseClient,
  clientIds: string[],
  month: number,
  year: number,
  opts?: { clientChunk?: number; pageSize?: number }
): Promise<{ categories: string[]; pricelists: string[]; error: string | null }> {
  const clientChunk = opts?.clientChunk ?? 80;
  const pageSize = opts?.pageSize ?? 1000;
  const catSet = new Set<string>();
  const plSet = new Set<string>();
  let lastError: string | null = null;

  if (clientIds.length === 0) {
    return { categories: [], pricelists: [], error: null };
  }

  for (let i = 0; i < clientIds.length; i += clientChunk) {
    const chunk = clientIds.slice(i, i + clientChunk);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("orders")
        .select("category, pricelist")
        .eq("month", month)
        .eq("year", year)
        .in("client_id", chunk)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        lastError = error.message;
        return {
          categories: Array.from(catSet).sort(sortLocale),
          pricelists: Array.from(plSet).sort(sortLocale),
          error: lastError,
        };
      }
      if (!data?.length) break;

      for (const r of data as { category?: string | null; pricelist?: string | null }[]) {
        const c = String(r.category ?? "").trim();
        if (c) catSet.add(c);
        const pl = String(r.pricelist ?? "").trim();
        if (pl) plSet.add(pl);
      }

      if (data.length < pageSize) break;
      from += pageSize;
    }
  }

  return {
    categories: Array.from(catSet).sort(sortLocale),
    pricelists: Array.from(plSet).sort(sortLocale),
    error: null,
  };
}

/** All client ids assigned to a salesperson (paginated). */
export async function fetchClientIdsForSalesperson(
  supabase: SupabaseClient,
  salespersonId: string
): Promise<{ ids: string[]; error: string | null }> {
  const ids: string[] = [];
  const pageSize = 1000;
  let from = 0;
  let lastError: string | null = null;
  for (;;) {
    const { data, error } = await supabase
      .from("clients")
      .select("id")
      .eq("salesperson_id", salespersonId)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      lastError = error.message;
      break;
    }
    if (!data?.length) break;
    for (const r of data as { id: string }[]) ids.push(r.id);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { ids, error: lastError };
}

export type ClientOrderImportFields = { category: string; pricelist: string; invoice: string };

/** Per client: distinct category / pricelist / invoice_ref from meter lines in the given month (not كارتيلا). */
export async function fetchClientMeterOrderImportFields(
  supabase: SupabaseClient,
  clientIds: string[],
  month: number,
  year: number,
  chunkSize = 120
): Promise<{ byClient: Map<string, ClientOrderImportFields>; error: string | null }> {
  const meta = new Map<string, { cats: Set<string>; pls: Set<string>; invs: Set<string> }>();
  let lastError: string | null = null;

  const joinSets = (s: Set<string>) =>
    Array.from(s)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .join("; ");

  for (let i = 0; i < clientIds.length; i += chunkSize) {
    const chunk = clientIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("orders")
      .select("client_id, category, pricelist, invoice_ref, quantity, products(name)")
      .eq("month", month)
      .eq("year", year)
      .in("client_id", chunk);

    if (error) {
      lastError = error.message;
      break;
    }

    for (const r of data ?? []) {
      const row = r as {
        client_id: string;
        category?: string | null;
        pricelist?: string | null;
        invoice_ref?: string | null;
        quantity?: number;
        products?: unknown;
      };
      const pname = productNameFromJoin(row);
      if (!pname || isKartelaProductName(pname)) continue;
      const qty = Number(row.quantity) || 0;
      if (qty <= 0) continue;

      const cid = row.client_id;
      if (!meta.has(cid)) meta.set(cid, { cats: new Set(), pls: new Set(), invs: new Set() });
      const m = meta.get(cid)!;

      const cat = String(row.category ?? "").trim();
      if (cat) m.cats.add(cat);
      const pl = String(row.pricelist ?? "").trim();
      if (pl) m.pls.add(pl);
      const inv = String(row.invoice_ref ?? "").trim();
      if (inv) m.invs.add(inv);
    }
  }

  const byClient = new Map<string, ClientOrderImportFields>();
  meta.forEach((v, k) => {
    byClient.set(k, {
      category: joinSets(v.cats),
      pricelist: joinSets(v.pls),
      invoice: joinSets(v.invs),
    });
  });

  return { byClient, error: lastError };
}
