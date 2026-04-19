import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { fetchClientLatestOrderLineFields, type ClientOrderImportFields } from "@/lib/orderImportMeta";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Returns latest order-line import fields per client (category, pricelist, invoice, branch, day date).
 * Uses the service role so we read all lines for the client in the period — browser RLS often hides
 * Odoo rows where orders.salesperson_id ≠ the rep even though the client is theirs.
 */
export async function POST(req: NextRequest) {
  const userClient = createServerClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await userClient.from("users").select("role").eq("id", user.id).maybeSingle();
  const role = profile?.role as string | undefined;
  if (role !== "admin" && role !== "sales") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    clientIds?: string[];
    month?: number;
    year?: number;
    /** When true, scan any month (fallback for sparse columns in selected month). */
    fallback?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawIds = Array.isArray(body.clientIds) ? body.clientIds : [];
  const clientIds = Array.from(new Set(rawIds.map((id) => String(id).trim()).filter(Boolean)));
  if (clientIds.length === 0) return NextResponse.json({ fields: {} });
  if (clientIds.length > 4000) return NextResponse.json({ error: "Too many clientIds" }, { status: 400 });

  let allowedIds = clientIds;
  if (role === "sales") {
    const { data: sp } = await userClient.from("salespersons").select("id").eq("user_id", user.id).maybeSingle();
    if (!sp?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data: okClients, error: ocErr } = await userClient
      .from("clients")
      .select("id")
      .in("id", clientIds)
      .eq("salesperson_id", sp.id);
    if (ocErr) return NextResponse.json({ error: ocErr.message }, { status: 500 });
    allowedIds = (okClients ?? []).map((c) => c.id);
    if (allowedIds.length === 0) return NextResponse.json({ fields: {} });
  }

  const db = getServiceClient();
  if (!db) {
    return NextResponse.json(
      {
        error:
          "Missing SUPABASE_SERVICE_ROLE_KEY on the server — order import columns cannot load. Add it to your deployment environment.",
      },
      { status: 503 }
    );
  }

  const month = body.fallback ? undefined : body.month;
  const year = body.fallback ? undefined : body.year;
  const opts =
    month != null && year != null && Number.isFinite(month) && Number.isFinite(year)
      ? { month: Number(month), year: Number(year) }
      : undefined;

  const merged = new Map<string, ClientOrderImportFields>();
  const CHUNK = 400;
  for (let i = 0; i < allowedIds.length; i += CHUNK) {
    const chunk = allowedIds.slice(i, i + CHUNK);
    const { byClient, error } = await fetchClientLatestOrderLineFields(db, chunk, opts);
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
    byClient.forEach((v, k) => merged.set(k, v));
  }

  const fields: Record<string, ClientOrderImportFields> = {};
  merged.forEach((v, k) => {
    fields[k] = v;
  });

  return NextResponse.json(
    { fields },
    { headers: { "Cache-Control": "no-store" } }
  );
}
