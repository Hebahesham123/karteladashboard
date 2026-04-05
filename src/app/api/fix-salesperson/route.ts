import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/fix-salesperson
 * Updates every client that has salesperson_id = NULL
 * by pulling the salesperson from their most recent order.
 */
export async function GET(_req: NextRequest) {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  ) as any;

  try {
    // Find clients with no salesperson
    const { data: nullClients } = await db
      .from("clients")
      .select("id")
      .is("salesperson_id", null);

    if (!nullClients?.length) {
      return NextResponse.json({ message: "All clients already have a salesperson.", fixed: 0 });
    }

    let fixed = 0;
    for (const client of nullClients) {
      // Get the salesperson from the client's most recent order
      const { data: order } = await db
        .from("orders")
        .select("salesperson_id")
        .eq("client_id", client.id)
        .not("salesperson_id", "is", null)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(1)
        .single();

      if (order?.salesperson_id) {
        await db
          .from("clients")
          .update({ salesperson_id: order.salesperson_id })
          .eq("id", client.id);
        fixed++;
      }
    }

    return NextResponse.json({ message: `Fixed ${fixed} of ${nullClients.length} clients.`, fixed });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
