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
 * Bounded, unlike the select it replaces: an unbounded read would silently
 * truncate at PostgREST's 1000-row cap anyway, so the limit is explicit and
 * the ordering deliberate — real people first, then everyone else, so the
 * likeliest recipients are the ones that survive the cut.
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

  // Spam senders are excluded outright — the compose box should never help
  // someone write to an address they've quarantined.
  const { data: rows } = await supabase
    .from("contacts")
    .select("address, display_name, tab")
    .neq("tab", "spam")
    .order("tab", { ascending: true })
    .order("display_name", { ascending: true, nullsFirst: false })
    .limit(SUGGESTION_LIMIT);

  const suggestions = (
    (rows ?? []) as {
      address: string;
      display_name: string | null;
      tab: string;
    }[]
  )
    // "company" sorts before "contact" alphabetically, but real people are the
    // likelier recipients, so the intended order is restored here rather than
    // being expressed as a fragile SQL ordering.
    .sort((a, b) => {
      if (a.tab !== b.tab) return a.tab === "contact" ? -1 : 1;
      return (a.display_name || a.address).localeCompare(
        b.display_name || b.address,
      );
    })
    .map((c) => ({
      address: c.address,
      label: c.display_name || fallbackLabel(c.address) || c.address,
    }));

  return NextResponse.json({ suggestions });
}
