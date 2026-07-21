import "server-only";
import { google } from "googleapis";
import { getAuthorizedClient } from "@/lib/gmail/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EmailAccount } from "@/lib/types";

/**
 * Message actions (MVP step: email actions).
 *
 * Trash rather than permanent delete: `gmail.modify` cannot hard-delete (that
 * needs the full `https://mail.google.com/` scope), and trashing is recoverable
 * for 30 days — which is what "delete" means in every mail client and what makes
 * an Undo affordance honest.
 *
 * Each action mirrors the change locally (`messages.trashed_at`) so the UI can
 * update immediately instead of waiting for the next sync to observe the label.
 */

export interface ActionResult {
  /** Wompy message ids affected, so an undo can target exactly these. */
  messageIds: string[];
}

/** Load the Gmail ids for a set of Wompy message ids owned by this user. */
async function gmailIdsFor(
  userId: string,
  messageIds: string[],
): Promise<{ id: string; gmail_message_id: string }[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select("id, gmail_message_id")
    .eq("user_id", userId)
    .in("id", messageIds);
  if (error) throw error;
  return (data ?? []) as { id: string; gmail_message_id: string }[];
}

/** All non-trashed message ids in a thread. */
export async function messageIdsInThread(
  userId: string,
  threadId: string,
): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select("id")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .is("trashed_at", null);
  if (error) throw error;
  return (data ?? []).map((r) => (r as { id: string }).id);
}

/**
 * Unread message ids in a thread.
 *
 * Used to skip the work entirely when a thread is already read — opening a
 * conversation should not cost a Gmail round-trip just to re-assert what is
 * already true, and this runs on every thread open.
 */
export async function unreadMessageIdsInThread(
  userId: string,
  threadId: string,
): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select("id")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .is("trashed_at", null)
    .contains("label_ids", [UNREAD_LABEL]);
  if (error) throw error;
  return (data ?? []).map((r) => (r as { id: string }).id);
}

const UNREAD_LABEL = "UNREAD";

/**
 * Mark messages read, in Gmail and locally.
 *
 * Gmail's UNREAD label is the source of truth (same arrangement as TRASH), so
 * there is no separate read_at column to drift out of sync. Reading mail in
 * Gmail clears it here on the next poll, and vice versa.
 *
 * Uses batchModify: one request for the whole thread rather than one per
 * message, since this fires on every thread open.
 */
export async function markMessagesRead(
  account: EmailAccount,
  messageIds: string[],
): Promise<ActionResult> {
  if (messageIds.length === 0) return { messageIds: [] };

  const rows = await gmailIdsFor(account.user_id, messageIds);
  if (rows.length === 0) return { messageIds: [] };

  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: {
      ids: rows.map((r) => r.gmail_message_id),
      removeLabelIds: [UNREAD_LABEL],
    },
  });

  // Mirror locally so the rail updates now rather than on the next poll.
  const admin = createAdminClient();
  const { error } = await admin.rpc("strip_message_label", {
    p_user_id: account.user_id,
    p_message_ids: rows.map((r) => r.id),
    p_label: UNREAD_LABEL,
  });
  if (error) throw error;

  return { messageIds: rows.map((r) => r.id) };
}

/** Mark messages unread again — the manual "leave it for later" path. */
export async function markMessagesUnread(
  account: EmailAccount,
  messageIds: string[],
): Promise<ActionResult> {
  if (messageIds.length === 0) return { messageIds: [] };

  const rows = await gmailIdsFor(account.user_id, messageIds);
  if (rows.length === 0) return { messageIds: [] };

  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: {
      ids: rows.map((r) => r.gmail_message_id),
      addLabelIds: [UNREAD_LABEL],
    },
  });

  const admin = createAdminClient();
  const { error } = await admin.rpc("add_message_label", {
    p_user_id: account.user_id,
    p_message_ids: rows.map((r) => r.id),
    p_label: UNREAD_LABEL,
  });
  if (error) throw error;

  return { messageIds: rows.map((r) => r.id) };
}

/**
 * Move messages to Gmail's Trash and mark them locally.
 *
 * Gmail is updated first: if that fails we surface the error rather than hiding
 * a message that is still sitting in the user's inbox.
 */
export async function trashMessages(
  account: EmailAccount,
  messageIds: string[],
): Promise<ActionResult> {
  if (messageIds.length === 0) return { messageIds: [] };

  const rows = await gmailIdsFor(account.user_id, messageIds);
  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  for (const row of rows) {
    await gmail.users.messages.trash({
      userId: "me",
      id: row.gmail_message_id,
    });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("messages")
    .update({ trashed_at: new Date().toISOString() })
    .eq("user_id", account.user_id)
    .in(
      "id",
      rows.map((r) => r.id),
    );
  if (error) throw error;

  return { messageIds: rows.map((r) => r.id) };
}

/** Restore messages from Trash — the Undo path. */
export async function untrashMessages(
  account: EmailAccount,
  messageIds: string[],
): Promise<ActionResult> {
  if (messageIds.length === 0) return { messageIds: [] };

  const rows = await gmailIdsFor(account.user_id, messageIds);
  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  for (const row of rows) {
    await gmail.users.messages.untrash({
      userId: "me",
      id: row.gmail_message_id,
    });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("messages")
    .update({ trashed_at: null })
    .eq("user_id", account.user_id)
    .in(
      "id",
      rows.map((r) => r.id),
    );
  if (error) throw error;

  return { messageIds: rows.map((r) => r.id) };
}
