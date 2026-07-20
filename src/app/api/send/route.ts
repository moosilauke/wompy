import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/env";
import { sendNewMessage, sendReply, MAX_CHAT_LENGTH } from "@/lib/gmail/send";
import { ingestMessageById } from "@/lib/gmail/sync";
import type { EmailAccount } from "@/lib/types";

/**
 * Send a message — either a reply within an existing thread, or a net-new
 * conversation with typed recipients.
 *
 * Body: { threadId, body } | { recipients: string[], body }
 * `fullEmail: true` opts out of the 365-character chat constraint.
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: {
    threadId?: string;
    recipients?: string[];
    body?: string;
    fullEmail?: boolean;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const body = (payload.body ?? "").trim();
  if (!body) {
    return NextResponse.json({ error: "empty_body" }, { status: 400 });
  }

  // The 365-char cap is a deliberate product constraint, not a technical limit;
  // `fullEmail` is the explicit escape hatch.
  if (!payload.fullEmail && body.length > MAX_CHAT_LENGTH) {
    return NextResponse.json(
      { error: "too_long", limit: MAX_CHAT_LENGTH, length: body.length },
      { status: 400 },
    );
  }

  // Resolve the sending account (first connected Gmail).
  const admin = createAdminClient();
  const { data: accounts, error: accountsError } = await admin
    .from("email_accounts")
    .select("*")
    .eq("user_id", user.id)
    .eq("provider", "gmail")
    .order("created_at", { ascending: true })
    .limit(1);
  if (accountsError) {
    return NextResponse.json({ error: "load_account_failed" }, { status: 500 });
  }
  const account = (accounts ?? [])[0] as EmailAccount | undefined;
  if (!account) {
    return NextResponse.json({ error: "no_account" }, { status: 400 });
  }

  try {
    const result = payload.threadId
      ? await sendReply(account, payload.threadId, body)
      : await sendNewMessage(account, payload.recipients ?? [], body);

    // Pull the sent message straight back in by id so it appears in the thread
    // immediately. Fetching by id (rather than running a sync) avoids the
    // watermark's second-granularity gap.
    try {
      if (result.gmailMessageId) {
        await ingestMessageById(account, result.gmailMessageId);
      }
    } catch {
      // Sending succeeded; a failed ingest is not fatal — the next poll will
      // pick the message up.
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        error: "send_failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
