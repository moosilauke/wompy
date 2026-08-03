import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { fallbackLabel } from "@/lib/email/addresses";

/**
 * Recipient suggestions for the net-new compose box.
 *
 * A route rather than page data: this is the whole address book, and it used
 * to be built on every render of the app page and serialized into the RSC
 * payload — including the overwhelming majority of renders where the compose
 * modal is never opened, and including every 2-minute background refresh. It
 * is only needed when someone actually starts a new message.
 *
 * Ordered by who the user actually corresponds with, not alphabetically —
 * see the contact_suggestions RPC (migration 0028) for the ranking. Opening
 * the box with three arbitrary names starting with "a" was no more useful
 * than opening it empty.
 */
const SUGGESTION_LIMIT = 500;

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Ranking (contacts before companies, replied-to first, then by volume and
  // recency) and the spam/malformed-address exclusions all live in the RPC —
  // it aggregates over threads, which isn't expressible as a PostgREST select.
  const { data: rows } = await supabase.rpc("contact_suggestions", {
    p_limit: SUGGESTION_LIMIT,
  });

  const suggestions = (
    (rows ?? []) as {
      address: string;
      display_name: string | null;
    }[]
  ).map((c) => ({
    address: c.address,
    label: c.display_name || fallbackLabel(c.address) || c.address,
  }));

  return NextResponse.json({ suggestions });
}
