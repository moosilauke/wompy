import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/env";
import { getAuthorizedClient } from "@/lib/gmail/auth";
import type { EmailAccount } from "@/lib/types";

/**
 * Stream an attachment's bytes from Gmail.
 *
 * Nothing is stored locally — sync keeps only metadata, and this fetches the
 * content on demand using Gmail's attachment id. Files stay where they already
 * live, so there's no duplication, no storage quota, and no stale copy after a
 * message is deleted.
 *
 * The lookup is scoped by user_id, so an attachment id from someone else's
 * mailbox resolves to nothing rather than leaking a file.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  // Ownership is enforced in the query itself: a row belonging to another user
  // simply isn't found.
  const { data: attachment, error } = await admin
    .from("attachments")
    .select("gmail_attachment_id, filename, mime_type, message_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!attachment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const row = attachment as {
    gmail_attachment_id: string;
    filename: string;
    mime_type: string | null;
    message_id: string;
  };

  // Gmail needs the owning message's id alongside the attachment id.
  const { data: message } = await admin
    .from("messages")
    .select("gmail_message_id, email_account_id")
    .eq("id", row.message_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!message) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const msg = message as {
    gmail_message_id: string;
    email_account_id: string;
  };

  const { data: account } = await admin
    .from("email_accounts")
    .select("*")
    .eq("id", msg.email_account_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ error: "no_account" }, { status: 400 });
  }

  try {
    const auth = await getAuthorizedClient(account as EmailAccount);
    const gmail = google.gmail({ version: "v1", auth });

    const result = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: msg.gmail_message_id,
      id: row.gmail_attachment_id,
    });

    const data = result.data.data;
    if (!data) {
      return NextResponse.json({ error: "empty_attachment" }, { status: 404 });
    }

    const bytes = Buffer.from(data, "base64url");

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": row.mime_type ?? "application/octet-stream",
        // `attachment` rather than `inline`: this is untrusted content from a
        // stranger, and letting the browser render it in our origin would be an
        // XSS vector for anything HTML- or SVG-shaped.
        "Content-Disposition": `attachment; filename="${sanitizeFilename(row.filename)}"`,
        "Content-Length": String(bytes.length),
        // Attachment bytes never change, but they are private — cache in the
        // browser only, never in a shared proxy.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "fetch_failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }
}

/**
 * Strip anything that would break out of the Content-Disposition quoting or
 * suggest a path. Filenames come from senders and are entirely untrusted.
 */
function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\r\n"\\]/g, "")
      .replace(/[/\\]/g, "-")
      .trim()
      .slice(0, 200) || "attachment"
  );
}
