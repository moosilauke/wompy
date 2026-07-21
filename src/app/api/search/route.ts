import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Search across people and messages.
 *
 * Runs through the user's own client rather than the admin one, so RLS scopes
 * results without this route having to be trusted with that. The RPCs are
 * additionally scoped by an explicit user_id predicate.
 */
export async function GET(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (!query) {
    return NextResponse.json({ contacts: [], messages: [] });
  }

  // Bounded so a pathological query can't ask the database for unlimited work.
  const bounded = query.slice(0, 200);

  const [people, messages] = await Promise.all([
    supabase.rpc("search_contacts", {
      p_user_id: userId,
      p_query: bounded,
      p_limit: 5,
    }),
    supabase.rpc("search_messages", {
      p_user_id: userId,
      p_query: bounded,
      p_limit: 20,
    }),
  ]);

  if (people.error || messages.error) {
    return NextResponse.json(
      {
        error: "search_failed",
        detail: people.error?.message ?? messages.error?.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    contacts: people.data ?? [],
    messages: messages.data ?? [],
  });
}
