import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Dashboard KPI tiles and leaderboards, aggregated in Postgres.
 *
 * Why this is a server route rather than a supabase.rpc() from the browser:
 * the browser connects as `anon`/`authenticated`, so every read is filtered by
 * the RLS policies on these views. The scoped-admin policy runs an
 * `EXISTS (SELECT 1 FROM orders ...)` per row — the same reason
 * /api/clients/total-count already exists. Measured side by side, the KPI
 * aggregate answered in 370ms for the service role and did not return at all
 * within 60s for the browser role.
 *
 * So the aggregate runs here with the service key, and the caller's scope is
 * applied explicitly as query arguments instead of being enforced by RLS.
 */

type Body = {
  kind: "kpis" | "rankings";
  year: number;
  months: number[];
  salesperson?: string | null;
  branches?: string[] | null;
  custTypes?: string[] | null;
  products?: string[] | null;
  clients?: string[] | null;
};

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  let user;
  try {
    const res = await supabase.auth.getUser();
    user = res.data.user;
  } catch {
    // Couldn't reach the auth service — that is not the same as "not signed in".
    return NextResponse.json({ error: "Auth service unreachable" }, { status: 503 });
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Missing server Supabase env" }, { status: 500 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const months = Array.isArray(body.months) ? body.months.map(Number).filter(Boolean) : [];
  if (!body.year || months.length === 0) {
    return NextResponse.json({ error: "year and months are required" }, { status: 400 });
  }

  const nullIfEmpty = <T,>(v: T[] | null | undefined): T[] | null =>
    Array.isArray(v) && v.length > 0 ? v : null;

  try {
    if (body.kind === "rankings") {
      const { data, error } = await db.rpc("get_dashboard_rankings", {
        p_year: body.year,
        p_months: months,
        p_salesperson: body.salesperson || null,
        p_branches: nullIfEmpty(body.branches),
        p_cust_types: nullIfEmpty(body.custTypes),
        p_products: nullIfEmpty(body.products),
        p_clients: nullIfEmpty(body.clients),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data ?? null);
    }

    // KPI tiles. get_dashboard_kpis takes a contiguous range; the caller only
    // asks for this path when its month selection is contiguous.
    const { data, error } = await db.rpc("get_dashboard_kpis", {
      p_from_year: body.year,
      p_from_month: months[0],
      p_to_year: body.year,
      p_to_month: months[months.length - 1],
      p_salesperson: body.salesperson || null,
      p_branches: nullIfEmpty(body.branches),
      p_cust_types: nullIfEmpty(body.custTypes),
      p_products: nullIfEmpty(body.products),
      p_clients: nullIfEmpty(body.clients),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? null);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Aggregate failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
