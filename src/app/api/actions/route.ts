import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/env";
import {
  markMessagesRead,
  markMessagesUnread,
  messageIdsInThread,
  trashMessages,
  unreadMessageIdsInThread,
  untrashMessages,
} from "@/lib/gmail/actions";
import { reclassifyThread } from "@/lib/email/reclassify";
import type { EmailAccount } from "@/lib/types";

/**
 * Message actions endpoint.
 *
 * Deliberately shaped as { action, target } rather than a per-action route, so
 * future actions (archive, snooze, reclassify) slot in by adding a case here and
 * an item to the context menu — no new plumbing.
 *
 * Body:
 *   { action: "trash" | "untrash" | "read" | "unread",
 *     threadId?: string,      // act on the whole conversation
 *     messageIds?: string[] } // or specific messages
 *
 *   { action: "reclassify", threadId, tab }
 */

const SUPPORTED = new Set([
  "trash",
  "untrash",
  "read",
  "unread",
  "reclassify",
]);

export async function POST(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createClient();
  // getClaims() verifies the JWT locally rather than round-tripping to the auth
  // server (~120ms) — this route is in the path of every menu action, so that
  // latency was directly visible as click lag.
  const { data: claims } = await supabase.auth.getClaims();
  // `sub` is the JWT subject claim: the user id.
  const userId = claims?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: {
    action?: string;
    threadId?: string;
    messageIds?: string[];
    tab?: string;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = payload.action ?? "";
  if (!SUPPORTED.has(action)) {
    return NextResponse.json({ error: "unsupported_action" }, { status: 400 });
  }

  // Reclassify is handled before the Gmail account lookup: it only rewrites our
  // own classification, touching no mail and needing no provider connection.
  if (action === "reclassify") {
    const tab = payload.tab;
    if (tab !== "contact" && tab !== "company" && tab !== "spam") {
      return NextResponse.json({ error: "invalid_tab" }, { status: 400 });
    }
    if (!payload.threadId) {
      return NextResponse.json({ error: "no_target" }, { status: 400 });
    }

    try {
      const result = await reclassifyThread(userId, payload.threadId, tab);
      return NextResponse.json({ ok: true, action, ...result });
    } catch (err) {
      return NextResponse.json(
        {
          error: "action_failed",
          detail: err instanceof Error ? err.message : "unknown",
        },
        { status: 500 },
      );
    }
  }

  // Resolve the acting account.
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

  // Resolve the target: an explicit message list, or every message in a thread.
  let targetIds: string[] = [];
  if (payload.messageIds && payload.messageIds.length > 0) {
    targetIds = payload.messageIds;
  } else if (payload.threadId) {
    targetIds =
      action === "read"
        ? // Only the unread ones: marking read fires on every thread open, and
          // re-asserting the label on an already-read conversation would cost a
          // pointless Gmail round-trip.
          await unreadMessageIdsInThread(userId, payload.threadId)
        : await messageIdsInThread(userId, payload.threadId);
  }

  if (targetIds.length === 0) {
    // Nothing to do is a success for read/unread — opening an already-read
    // conversation is the common case, not an error.
    if (action === "read" || action === "unread") {
      return NextResponse.json({ ok: true, action, messageIds: [] });
    }
    return NextResponse.json({ error: "no_target" }, { status: 400 });
  }

  try {
    let result;
    switch (action) {
      case "trash":
        result = await trashMessages(account, targetIds);
        break;
      case "untrash":
        result = await untrashMessages(account, targetIds);
        break;
      case "read":
        result = await markMessagesRead(account, targetIds);
        break;
      default:
        result = await markMessagesUnread(account, targetIds);
    }

    return NextResponse.json({ ok: true, action, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        error: "action_failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
