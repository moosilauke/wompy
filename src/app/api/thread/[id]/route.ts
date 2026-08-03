import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { canonicalAddress } from "@/lib/email/addresses";
import { loadPaneMessages } from "@/lib/email/pane";

/**
 * The messages of one conversation.
 *
 * Opening a conversation used to be a full server navigation: clicking a rail
 * row re-ran the entire force-dynamic app page — every tab's rail, the tab
 * counts, the contact list, the read watermarks — to change what was in the
 * reading pane. This route is the scoped version of the only part that
 * actually depends on which thread was clicked.
 *
 * Deliberately returns messages ONLY, not the thread header. The client
 * already holds the label, address, participants, and logo for every rail row,
 * so it paints the header on the same frame as the click and fills the bubbles
 * in when this responds. Sending the header again would be a slower way to
 * show what is already on screen.
 *
 * Mapping (excerpting, outgoing detection, HTML-to-text) lives in
 * lib/email/pane.ts, shared with the server-rendered path so the two can't
 * drift — in particular, body_html never reaches the client from either.
 *
 * All reads go through the RLS-scoped client rather than the admin client:
 * this only ever needs the caller's own rows, and RLS is what enforces that a
 * thread id from another user's mailbox returns nothing.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createClient();
  // Local JWT verification, not getUser() — this is on the click path, and an
  // auth-server round-trip here is directly visible as lag (same reasoning as
  // api/actions).
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: threadId } = await params;
  if (!threadId) {
    return NextResponse.json({ error: "invalid_thread" }, { status: 400 });
  }

  // Confirms the thread exists AND belongs to the caller (RLS scopes the
  // read), so a bad or foreign id is a 404 rather than an empty pane that
  // looks like a conversation with nothing in it.
  const { data: thread } = await supabase
    .from("threads")
    .select("id")
    .eq("id", threadId)
    .maybeSingle();

  if (!thread) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("email");
  const selfAddresses = new Set(
    ((accounts ?? []) as { email: string }[]).map((a) =>
      canonicalAddress(a.email),
    ),
  );

  // `?before=<iso>` walks back through a long conversation; absent means the
  // newest page.
  const before = new URL(request.url).searchParams.get("before");

  const { messages, olderCursor } = await loadPaneMessages(
    supabase,
    threadId,
    selfAddresses,
    before,
  );

  return NextResponse.json({ messages, olderCursor });
}
