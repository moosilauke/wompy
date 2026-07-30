import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/env";
import {
  messageIdsInThread,
  trashMessages,
  untrashMessages,
} from "@/lib/gmail/actions";
import { reclassifyThreads } from "@/lib/email/reclassify";
import {
  markThreadRead,
  markThreadUnread,
  markThreadsRead,
  markThreadsUnread,
} from "@/lib/email/read-state";
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
 *     threadIds?: string[],   // or several, from the rail's multi-select
 *     messageIds?: string[] } // or specific messages
 *
 *   { action: "reclassify", threadId?: string, threadIds?: string[], tab }
 *
 * threadId and threadIds are never both meaningful at once — threadIds wins
 * when present, so callers don't need to special-case a single-element array.
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
    threadIds?: string[];
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

  // threadIds (the rail's multi-select) wins over a single threadId when both
  // are somehow present, and a lone threadId is normalized into a one-element
  // array — every handler below only ever deals with a list.
  const threadIds =
    payload.threadIds && payload.threadIds.length > 0
      ? payload.threadIds
      : payload.threadId
        ? [payload.threadId]
        : [];

  // Read/unread are Wompy-native now (a per-thread watermark in Supabase), so
  // they touch no mail and need no Gmail account. Handled before the account
  // lookup, like reclassify.
  if (action === "read" || action === "unread") {
    if (threadIds.length === 0) {
      return NextResponse.json({ error: "no_target" }, { status: 400 });
    }
    try {
      if (action === "read") {
        if (threadIds.length === 1) await markThreadRead(userId, threadIds[0]);
        else await markThreadsRead(userId, threadIds);
      } else {
        if (threadIds.length === 1) await markThreadUnread(userId, threadIds[0]);
        else await markThreadsUnread(userId, threadIds);
      }
      return NextResponse.json({ ok: true, action });
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

  // Reclassify is handled before the Gmail account lookup: it only rewrites our
  // own classification, touching no mail and needing no provider connection.
  if (action === "reclassify") {
    const tab = payload.tab;
    if (tab !== "contact" && tab !== "company" && tab !== "spam") {
      return NextResponse.json({ error: "invalid_tab" }, { status: 400 });
    }
    if (threadIds.length === 0) {
      return NextResponse.json({ error: "no_target" }, { status: 400 });
    }

    try {
      const result = await reclassifyThreads(userId, threadIds, tab);
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

  // Resolve the target: an explicit message list, or every message across the
  // given thread(s) — one or several, from a single conversation or the
  // rail's multi-select. Remaining actions (trash / untrash) operate on
  // messages, flattened across every thread since batchModify doesn't care
  // which thread a message came from.
  let targetIds: string[] = [];
  if (payload.messageIds && payload.messageIds.length > 0) {
    targetIds = payload.messageIds;
  } else if (threadIds.length > 0) {
    const perThread = await Promise.all(
      threadIds.map((id) => messageIdsInThread(userId, id)),
    );
    targetIds = perThread.flat();
  }

  if (targetIds.length === 0) {
    return NextResponse.json({ error: "no_target" }, { status: 400 });
  }

  try {
    const result =
      action === "trash"
        ? await trashMessages(account, targetIds)
        : await untrashMessages(account, targetIds);

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
