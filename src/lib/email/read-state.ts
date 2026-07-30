import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Wompy-native read state, as a per-thread watermark.
 *
 * A thread is unread when its newest message is newer than the user's
 * `last_read_at` for it. Opening a thread advances the watermark to that
 * thread's latest message. No Gmail round-trip is involved — this is Wompy's
 * own view of what's been seen, and it follows the user across devices via
 * Supabase.
 *
 * A thread with no watermark row is treated as read: the cutover migration
 * seeded every existing thread, so an absent row means a thread created after
 * the switch that the user hasn't opened — but new threads are created by
 * incoming mail, which SHOULD read as unread. That case is handled at the call
 * site (page.tsx), which knows each thread's latest-message time and compares
 * directly; this module handles the writes.
 */

/**
 * Mark a thread read up to its newest message.
 *
 * Upserts the watermark to the thread's latest message time. Idempotent:
 * re-opening an already-read thread rewrites the same value.
 */
export async function markThreadRead(
  userId: string,
  threadId: string,
): Promise<void> {
  const admin = createAdminClient();

  const { data: thread } = await admin
    .from("threads")
    .select("last_message_at")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  const lastMessageAt =
    (thread as { last_message_at: string | null } | null)?.last_message_at ??
    new Date().toISOString();

  const { error } = await admin.from("thread_reads").upsert(
    {
      user_id: userId,
      thread_id: threadId,
      last_read_at: lastMessageAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,thread_id" },
  );
  if (error) throw error;
}

/**
 * Mark a thread unread.
 *
 * Sets the watermark just before the thread's newest message, so that message
 * (and anything after) reads as unread again. Used by the manual "Mark as
 * unread" action.
 */
export async function markThreadUnread(
  userId: string,
  threadId: string,
): Promise<void> {
  const admin = createAdminClient();

  const { data: thread } = await admin
    .from("threads")
    .select("last_message_at")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  const lastMessageAt = (thread as { last_message_at: string | null } | null)
    ?.last_message_at;
  if (!lastMessageAt) return; // Empty thread: nothing to be unread about.

  // One millisecond before the newest message: the watermark now sits behind
  // it, so the thread is unread, without needing a separate "explicitly unread"
  // flag.
  const justBefore = new Date(
    new Date(lastMessageAt).getTime() - 1,
  ).toISOString();

  const { error } = await admin.from("thread_reads").upsert(
    {
      user_id: userId,
      thread_id: threadId,
      last_read_at: justBefore,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,thread_id" },
  );
  if (error) throw error;
}

/**
 * Mark several threads read, in one round-trip — the rail's multi-select
 * "Mark as read" action.
 *
 * Each thread gets its own watermark row (a thread's `last_message_at` isn't
 * shared with any other thread), so this is one bulk `select` for all the
 * thread rows plus one bulk `upsert`, rather than looping `markThreadRead`
 * per id — same end state, far fewer round-trips for a large selection.
 */
export async function markThreadsRead(
  userId: string,
  threadIds: string[],
): Promise<void> {
  if (threadIds.length === 0) return;
  const admin = createAdminClient();

  const { data: threads, error: threadsError } = await admin
    .from("threads")
    .select("id, last_message_at")
    .eq("user_id", userId)
    .in("id", threadIds);
  if (threadsError) throw threadsError;

  const now = new Date().toISOString();
  const rows = (threads ?? []).map((t) => {
    const row = t as { id: string; last_message_at: string | null };
    return {
      user_id: userId,
      thread_id: row.id,
      last_read_at: row.last_message_at ?? now,
      updated_at: now,
    };
  });
  if (rows.length === 0) return;

  const { error } = await admin
    .from("thread_reads")
    .upsert(rows, { onConflict: "user_id,thread_id" });
  if (error) throw error;
}

/**
 * Mark several threads unread, in one round-trip — the rail's multi-select
 * "Mark as unread" action. Same one-millisecond-before-latest trick as
 * `markThreadUnread`, applied per thread in a single bulk upsert.
 */
export async function markThreadsUnread(
  userId: string,
  threadIds: string[],
): Promise<void> {
  if (threadIds.length === 0) return;
  const admin = createAdminClient();

  const { data: threads, error: threadsError } = await admin
    .from("threads")
    .select("id, last_message_at")
    .eq("user_id", userId)
    .in("id", threadIds);
  if (threadsError) throw threadsError;

  const now = new Date().toISOString();
  const rows = (threads ?? [])
    .map((t) => t as { id: string; last_message_at: string | null })
    .filter((row) => row.last_message_at !== null)
    .map((row) => ({
      user_id: userId,
      thread_id: row.id,
      last_read_at: new Date(
        new Date(row.last_message_at as string).getTime() - 1,
      ).toISOString(),
      updated_at: now,
    }));
  if (rows.length === 0) return;

  const { error } = await admin
    .from("thread_reads")
    .upsert(rows, { onConflict: "user_id,thread_id" });
  if (error) throw error;
}
