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
