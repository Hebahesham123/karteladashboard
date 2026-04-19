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

export type ClientOrderImportFields = {
  product: string;
  category: string;
  pricelist: string;
  invoice: string;
  /** From order line `branch` (e.g. Odoo Invoice lines/Branch). */
  branch: string;
  /** Calendar day from invoice_date or created_at. */
  dayDate: string;
};

function formatOrderLineDayDate(invoiceDate: unknown, createdAt: unknown): string {
  const raw =
    invoiceDate != null && String(invoiceDate).trim() !== ""
      ? invoiceDate
      : createdAt != null && String(createdAt).trim() !== ""
        ? createdAt
        : null;
  if (raw == null) return "";
  const t = Date.parse(String(raw));
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Prefer lines with branch / date so the "latest" row isn't always chosen when it's sparse. */
function pickBestOrderLineForClientImport(
  rows: {
    client_id: string;
    category?: string | null;
    pricelist?: string | null;
    invoice_ref?: string | null;
    branch?: string | null;
    invoice_date?: string | null;
    created_at?: string | null;
    products?: unknown;
  }[]
): (typeof rows)[0] | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];
  const score = (row: (typeof rows)[0]) => {
    const br = String(row.branch ?? "").trim();
    const dd = formatOrderLineDayDate(row.invoice_date, row.created_at);
    const ts = Date.parse(String(row.created_at ?? "")) || 0;
    return (br ? 1_000_000 : 0) + (dd ? 10_000 : 0) + ts / 1e15;
  };
  return [...rows].sort((a, b) => score(b) - score(a))[0] ?? rows[0];
}

/** Per client: distinct category / pricelist / invoice_ref from meter lines in the given month (not كارتيلا). */
export async function fetchClientMeterOrderImportFields(
  supabase: SupabaseClient,
  clientIds: string[],
  month: number,
  year: number,
  chunkSize = 120
): Promise<{ byClient: Map<string, ClientOrderImportFields>; error: string | null }> {
  const meta = new Map<string, { products: Set<string>; cats: Set<string>; pls: Set<string>; invs: Set<string> }>();
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

      const cid = row.client_id;
      if (!meta.has(cid)) meta.set(cid, { products: new Set(), cats: new Set(), pls: new Set(), invs: new Set() });
      const m = meta.get(cid)!;
      if (pname) m.products.add(pname);

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
      product: joinSets(v.products),
      category: joinSets(v.cats),
      pricelist: joinSets(v.pls),
      invoice: joinSets(v.invs),
      branch: "",
      dayDate: "",
    });
  });

  return { byClient, error: lastError };
}

/**
 * Fallback per client: latest available non-empty product/category/pricelist/invoice
 * from any month/year (used when selected month has sparse import columns).
 */
export async function fetchClientLatestOrderImportFallbackFields(
  supabase: SupabaseClient,
  clientIds: string[],
  chunkSize = 120
): Promise<{ byClient: Map<string, ClientOrderImportFields>; error: string | null }> {
  const byClient = new Map<string, ClientOrderImportFields>();
  let lastError: string | null = null;

  const pick = (v: unknown) => String(v ?? "").trim();

  for (let i = 0; i < clientIds.length; i += chunkSize) {
    const chunk = clientIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("orders")
      .select("client_id, category, pricelist, invoice_ref, month, year, created_at, products(name)")
      .in("client_id", chunk)
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .order("created_at", { ascending: false });

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
        products?: unknown;
      };
      const cid = row.client_id;
      if (!cid) continue;

      const current = byClient.get(cid) ?? {
        product: "",
        category: "",
        pricelist: "",
        invoice: "",
        branch: "",
        dayDate: "",
      };
      const next: ClientOrderImportFields = {
        product: current.product || pick(productNameFromJoin(row)),
        category: current.category || pick(row.category),
        pricelist: current.pricelist || pick(row.pricelist),
        invoice: current.invoice || pick(row.invoice_ref),
        branch: current.branch,
        dayDate: current.dayDate,
      };
      byClient.set(cid, next);
    }
  }

  return { byClient, error: lastError };
}

/**
 * Per client, pick ONE latest order line and return its exact fields.
 * This keeps each table row consistent (no merged multi-value strings).
 * If month/year are provided, search only that period.
 */
export async function fetchClientLatestOrderLineFields(
  supabase: SupabaseClient,
  clientIds: string[],
  opts?: { month?: number; year?: number; chunkSize?: number }
): Promise<{ byClient: Map<string, ClientOrderImportFields>; error: string | null }> {
  const byClient = new Map<string, ClientOrderImportFields>();
  let lastError: string | null = null;
  const chunkSize = opts?.chunkSize ?? 120;

  const clean = (v: unknown) => String(v ?? "").trim();

  /** PostgREST / Supabase default max rows is often 1000; paginate or many clients never appear. */
  const PAGE_SIZE = 1000;
  const ORDER_SELECT =
    "client_id, category, pricelist, invoice_ref, branch, invoice_date, created_at, month, year, products!left(name)";

  for (let i = 0; i < clientIds.length; i += chunkSize) {
    const chunk = clientIds.slice(i, i + chunkSize);
    const allRows: Record<string, unknown>[] = [];
    let rangeFrom = 0;
    for (;;) {
      let q = supabase
        .from("orders")
        .select(ORDER_SELECT)
        .in("client_id", chunk)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .order("created_at", { ascending: false })
        .range(rangeFrom, rangeFrom + PAGE_SIZE - 1);

      if (opts?.month != null && opts?.year != null) {
        q = q.eq("month", opts.month).eq("year", opts.year);
      }

      const { data, error } = await q;
      if (error) {
        lastError = error.message;
        break;
      }
      const batch = data ?? [];
      for (const r of batch) allRows.push(r as Record<string, unknown>);
      if (batch.length < PAGE_SIZE) break;
      rangeFrom += PAGE_SIZE;
      if (rangeFrom > 80_000) break;
    }
    if (lastError) break;

    type OrderRow = (typeof allRows)[number];
    const byCid = new Map<string, OrderRow[]>();
    for (const r of allRows) {
      const row = r as { client_id: string };
      const cid = row.client_id;
      if (!cid) continue;
      if (!byCid.has(cid)) byCid.set(cid, []);
      byCid.get(cid)!.push(r);
    }

    byCid.forEach((list, cid) => {
      const best = pickBestOrderLineForClientImport(list as Parameters<typeof pickBestOrderLineForClientImport>[0]);
      if (!best) return;
      const row = best as {
        client_id: string;
        category?: string | null;
        pricelist?: string | null;
        invoice_ref?: string | null;
        branch?: string | null;
        invoice_date?: string | null;
        created_at?: string | null;
        products?: unknown;
      };
      byClient.set(cid, {
        product: clean(productNameFromJoin(row)),
        category: clean(row.category),
        pricelist: clean(row.pricelist),
        invoice: clean(row.invoice_ref),
        branch: clean(row.branch),
        dayDate: formatOrderLineDayDate(row.invoice_date, row.created_at),
      });
    });
  }

  return { byClient, error: lastError };
}
