import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/env";
import { sendReaction, ReactionUnsupportedError } from "@/lib/gmail/send";
import { ingestMessageById } from "@/lib/gmail/sync";
import type { EmailAccount } from "@/lib/types";

/**
 * Send an emoji reaction to a message.
 *
 * Separate from /api/send because a reaction has no body — it is a specially
 * formed email whose whole payload is the emoji — and its own failure shape:
 * `reaction_unsupported` when the conversation's recipients use clients that
 * would show it as a plain reply.
 *
 * Body: { messageId, emoji }
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: { messageId?: string; emoji?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!payload.messageId || !payload.emoji) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: accounts, error: accountsError } = await admin
    .from("email_accounts")
    .select("*")
    .eq("user_id", userId)
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
    const result = await sendReaction(
      account,
      payload.messageId,
      payload.emoji,
    );

    // Pull our own reaction straight back in so its badge appears immediately.
    // It flows through the normal receive path — detected, stored, its carrier
    // flagged — so nothing reaction-specific is duplicated here.
    try {
      if (result.gmailMessageId) {
        await ingestMessageById(account, result.gmailMessageId);
      }
    } catch {
      // Sending succeeded; a failed ingest just delays the badge until the next
      // poll.
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // A recipient-support failure is the user's to know about and is not a
    // server error — surface it as a 400 with its own code.
    if (err instanceof ReactionUnsupportedError) {
      return NextResponse.json(
        { error: err.code, detail: err.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "react_failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
