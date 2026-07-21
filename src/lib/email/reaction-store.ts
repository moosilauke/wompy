import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Persisting received reactions.
 *
 * A reaction arrives as an ordinary email, so sync stores it like any other
 * message and then this moves it aside: the emoji is recorded against its
 * target, and the carrier message is flagged so the conversation view skips it.
 * Without that flag every reaction would show up as a one-character reply,
 * which is exactly the outcome reactions exist to avoid.
 *
 * Linking is by `In-Reply-To` → the target's `Message-ID` header, not by our
 * own row ids, because a reaction can arrive BEFORE the message it refers to —
 * mail ordering is not guaranteed, and the target may be outside the sync
 * window entirely. Unlinked reactions are kept with a null `message_id` and
 * attached later by `linkPendingReactions`.
 */

export interface StoredReaction {
  gmailMessageId: string;
  targetMessageIdHeader: string | null;
  fromAddress: string;
  emoji: string;
  reactedAt: string | null;
}

/**
 * Record reactions and flag their carrier messages.
 *
 * Failures are logged rather than thrown: a reaction that doesn't land is a
 * missing badge, which is worth far less than the sync it would otherwise fail.
 */
export async function storeReactions(
  userId: string,
  reactions: StoredReaction[],
): Promise<number> {
  if (reactions.length === 0) return 0;

  const admin = createAdminClient();

  // Resolve targets by Message-ID header. One query for all of them rather than
  // one per reaction.
  const targetHeaders = reactions
    .map((r) => r.targetMessageIdHeader)
    .filter((h): h is string => Boolean(h));

  const messageIdByHeader = new Map<string, string>();
  if (targetHeaders.length > 0) {
    const { data: targets } = await admin
      .from("messages")
      .select("id, message_id_header")
      .eq("user_id", userId)
      .in("message_id_header", targetHeaders);

    for (const row of (targets ?? []) as {
      id: string;
      message_id_header: string | null;
    }[]) {
      if (row.message_id_header) {
        messageIdByHeader.set(row.message_id_header, row.id);
      }
    }
  }

  const rows = reactions.map((r) => ({
    user_id: userId,
    message_id: r.targetMessageIdHeader
      ? (messageIdByHeader.get(r.targetMessageIdHeader) ?? null)
      : null,
    gmail_message_id: r.gmailMessageId,
    target_message_id_header: r.targetMessageIdHeader,
    from_address: r.fromAddress,
    emoji: r.emoji,
    reacted_at: r.reactedAt,
  }));

  const { error } = await admin
    .from("reactions")
    .upsert(rows, { onConflict: "user_id,gmail_message_id" });

  if (error) {
    console.error("Failed to store reactions:", error.message);
    return 0;
  }

  // Flag the carriers so they don't render as messages.
  const { error: flagError } = await admin
    .from("messages")
    .update({ is_reaction: true })
    .eq("user_id", userId)
    .in(
      "gmail_message_id",
      reactions.map((r) => r.gmailMessageId),
    );

  if (flagError) {
    console.error("Failed to flag reaction carriers:", flagError.message);
  }

  return rows.length;
}

/**
 * Attach reactions whose target hadn't been synced when they arrived.
 *
 * Cheap enough to run after every sync: the partial index means only unlinked
 * rows are scanned, and on a settled mailbox there are none.
 */
export async function linkPendingReactions(userId: string): Promise<number> {
  const admin = createAdminClient();

  const { data: pending } = await admin
    .from("reactions")
    .select("id, target_message_id_header")
    .eq("user_id", userId)
    .is("message_id", null)
    .not("target_message_id_header", "is", null);

  if (!pending || pending.length === 0) return 0;

  const headers = (pending as { target_message_id_header: string }[]).map(
    (r) => r.target_message_id_header,
  );

  const { data: targets } = await admin
    .from("messages")
    .select("id, message_id_header")
    .eq("user_id", userId)
    .in("message_id_header", headers);

  const messageIdByHeader = new Map(
    ((targets ?? []) as { id: string; message_id_header: string }[]).map(
      (m) => [m.message_id_header, m.id],
    ),
  );

  let linked = 0;
  for (const row of pending as {
    id: string;
    target_message_id_header: string;
  }[]) {
    const messageId = messageIdByHeader.get(row.target_message_id_header);
    if (!messageId) continue;

    const { error } = await admin
      .from("reactions")
      .update({ message_id: messageId })
      .eq("id", row.id);
    if (!error) linked += 1;
  }

  return linked;
}
