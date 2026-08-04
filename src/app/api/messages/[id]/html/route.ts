import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { sanitizeEmailHtml, MAX_HTML_BYTES } from "@/lib/email/sanitize-html";

/**
 * The original HTML of one message, sanitized for display in "View original".
 *
 * This is the ONLY read path in the app that pulls `body_html`, and it pulls it
 * for exactly one message at a time. `lib/email/pane.ts` deliberately excludes
 * that column because it is ~91% of a thread's bytes — that saving must survive
 * this feature, so nothing here should tempt the pane loader into fetching HTML
 * for a whole conversation.
 *
 * The response is safe to render, but only inside the sandboxed frame the
 * client puts it in. Sanitizing is the first of two layers, not the only one:
 * see `lib/email/sanitize-html.ts` for why both exist.
 */

// sanitize-html is a Node library (htmlparser2), not Edge-compatible. The other
// routes get Node by default; this one states it because it is load-bearing.
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createClient();
  // Local JWT verification rather than getUser() — this is on the click path
  // for opening a message, same reasoning as api/actions and api/thread.
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "invalid_message" }, { status: 400 });
  }

  // RLS-scoped client, not the admin client: RLS is what makes a message id
  // from someone else's mailbox resolve to nothing rather than leak a body.
  const { data: message } = await supabase
    .from("messages")
    .select("id, body_html")
    .eq("id", id)
    .maybeSingle();

  if (!message) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rawHtml = (message as { body_html: string | null }).body_html;

  // ~2% of messages have no HTML at all. Not an error — the modal keeps
  // showing the plain-text body it already has.
  if (!rawHtml) {
    return NextResponse.json({ html: null, blockedImageCount: 0 });
  }

  // A pathological row shouldn't tie up a request or ship a multi-megabyte
  // srcdoc. The client falls back to plain text.
  if (rawHtml.length > MAX_HTML_BYTES) {
    return NextResponse.json({
      html: null,
      blockedImageCount: 0,
      tooLarge: true,
    });
  }

  // Images are blocked here and restored client-side on request, so the
  // "Show images" button costs no second round trip. `?images=1` is for the
  // user's saved preference, where blocking then immediately restoring would
  // be wasted work.
  const allowRemoteImages =
    new URL(request.url).searchParams.get("images") === "1";

  const { html, blockedImageCount } = sanitizeEmailHtml(rawHtml, {
    allowRemoteImages,
  });

  return NextResponse.json(
    { html, blockedImageCount },
    {
      headers: {
        // Private only — this is mail content, and it must never sit in a
        // shared cache. Short window so reopening a message doesn't re-parse.
        "Cache-Control": "private, max-age=300",
      },
    },
  );
}
