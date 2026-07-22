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
): Promise<{ id: string; gmail_message_id: string; label_ids: string[] }[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select("id, gmail_message_id, label_ids")
    .eq("user_id", userId)
    .in("id", messageIds);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      gmail_message_id: string;
      label_ids: string[] | null;
    };
    return { ...row, label_ids: row.label_ids ?? [] };
  });
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
  if (rows.length === 0) return { messageIds: [] };

  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  // One request for the whole set. `messages.trash` is per-message, so deleting
  // a conversation used to cost one sequential round-trip per message —
  // noticeably slow on a long thread. batchModify applies the TRASH label to
  // every id at once, which is what trashing is underneath.
  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: {
      ids: rows.map((r) => r.gmail_message_id),
      addLabelIds: ["TRASH"],
      // Trashing removes a message from the inbox; without this it would keep
      // showing there in Gmail.
      removeLabelIds: ["INBOX"],
    },
  });

  // Only `trashed_at` is written: `label_ids` deliberately keeps its pre-trash
  // value so undo can tell an archived message from an inboxed one and restore
  // each correctly. The next sync reconciles the array with Gmail.
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
  if (rows.length === 0) return { messageIds: [] };

  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  // Batched for the same reason as trashing — undo should feel instant.
  //
  // Split by whether the message was in the inbox when it was trashed: most
  // trashed mail here (36 of 52) was already archived, and blanket-restoring
  // INBOX would resurrect it into the inbox rather than back where it was.
  const wasInInbox = rows.filter((r) => r.label_ids.includes("INBOX"));
  const wasArchived = rows.filter((r) => !r.label_ids.includes("INBOX"));

  await Promise.all([
    wasInInbox.length > 0
      ? gmail.users.messages.batchModify({
          userId: "me",
          requestBody: {
            ids: wasInInbox.map((r) => r.gmail_message_id),
            removeLabelIds: ["TRASH"],
            addLabelIds: ["INBOX"],
          },
        })
      : null,
    wasArchived.length > 0
      ? gmail.users.messages.batchModify({
          userId: "me",
          requestBody: {
            ids: wasArchived.map((r) => r.gmail_message_id),
            removeLabelIds: ["TRASH"],
          },
        })
      : null,
  ]);

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
