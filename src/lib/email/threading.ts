import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildParticipantSet,
  canonicalAddress,
  collectParticipants,
  parseAddress,
  parseAddressList,
} from "@/lib/email/addresses";

/**
 * Participant-set thread grouping (MVP build step 3).
 *
 * Thread key = the sorted set of participants on a message EXCLUDING the user,
 * so conversations group the way chat apps do rather than by Gmail's threadId or
 * by subject. Subject changes never split a thread.
 *
 * Runs at the end of every sync and is idempotent: re-deriving the same messages
 * produces the same keys and updates rather than duplicating.
 */

interface ThreadableMessage {
  id: string;
  from_address: string | null;
  to_addresses: string[] | null;
  cc_addresses: string[] | null;
  internal_date: string | null;
}

export interface ThreadingResult {
  threadsTouched: number;
  messagesLinked: number;
  contactsTouched: number;
  /** Ids/addresses actually touched, so a caller can scope downstream work
   * (classification) to what changed instead of the whole mailbox. */
  threadIds: string[];
  contactAddresses: string[];
}

/**
 * Group the given messages into threads for one account, upserting `threads` and
 * `contacts` and setting `messages.thread_id`.
 *
 * Uses the service-role client (bypasses RLS) and sets user_id explicitly, same
 * as the sync writer.
 */
export async function groupMessagesIntoThreads(
  userId: string,
  selfAddress: string,
  messages: ThreadableMessage[],
): Promise<ThreadingResult> {
  if (messages.length === 0) {
    return {
      threadsTouched: 0,
      messagesLinked: 0,
      contactsTouched: 0,
      threadIds: [],
      contactAddresses: [],
    };
  }

  const admin = createAdminClient();

  // 1. Bucket messages by participant key, tracking the latest activity and the
  //    best-known display name for each participant address.
  interface Bucket {
    participants: string[];
    participantKey: string;
    messageIds: string[];
    lastMessageAt: string | null;
  }
  const buckets = new Map<string, Bucket>();
  const contactNames = new Map<string, string | null>();
  // Bare lowercased (NOT canonicalized) addresses of everyone the user has
  // sent TO/CC'd in this batch — keyed the same way contactNames/contacts.address
  // are, so it can be checked directly against contactRows below. This is the
  // incremental source for contacts.has_replied (see migration 0018):
  // recomputing "have I ever replied to X" by scanning all sent mail doesn't
  // scale to a large mailbox, so this sets a one-way flag here, at the point a
  // reply is actually ingested, and classify-run.ts never has to scan for it.
  const repliedToAddresses = new Set<string>();
  const selfCanonical = canonicalAddress(selfAddress);

  for (const msg of messages) {
    const parsed = collectParticipants(msg);
    for (const p of parsed) {
      if (p.address === selfAddress.toLowerCase()) continue;
      const existing = contactNames.get(p.address);
      if (existing === undefined || (!existing && p.displayName)) {
        contactNames.set(p.address, p.displayName);
      }
    }

    const fromParsed = msg.from_address ? parseAddress(msg.from_address) : null;
    if (fromParsed && canonicalAddress(fromParsed.address) === selfCanonical) {
      for (const p of [
        ...parseAddressList(msg.to_addresses),
        ...parseAddressList(msg.cc_addresses),
      ]) {
        // Canonical check only to correctly exclude alias forms of the
        // user's own address; the stored key is the bare address, matching
        // contactNames/contacts.address's convention.
        if (canonicalAddress(p.address) !== selfCanonical) {
          repliedToAddresses.add(p.address);
        }
      }
    }

    const { participants, participantKey } = buildParticipantSet(
      parsed.map((p) => p.address),
      selfAddress,
    );

    let bucket = buckets.get(participantKey);
    if (!bucket) {
      bucket = {
        participants,
        participantKey,
        messageIds: [],
        lastMessageAt: null,
      };
      buckets.set(participantKey, bucket);
    }
    bucket.messageIds.push(msg.id);
    if (
      msg.internal_date &&
      (!bucket.lastMessageAt || msg.internal_date > bucket.lastMessageAt)
    ) {
      bucket.lastMessageAt = msg.internal_date;
    }
  }

  // 2. Upsert contacts (names for the rail). Classification stays at its default
  //    until the classifier step fills `tab` / `classification_signals`.
  //
  //    has_replied is only ever included as `true`, and only for addresses
  //    actually replied to in this batch — never `false`. It's a one-way flag
  //    (once you've replied to someone, that never becomes untrue), and
  //    omitting the key entirely for everyone else means PostgREST's upsert
  //    leaves their existing value alone on conflict rather than clobbering it
  //    back to the column default.
  const contactRows = [...contactNames.entries()].map(([address, name]) => ({
    user_id: userId,
    address,
    display_name: name,
    ...(repliedToAddresses.has(address) ? { has_replied: true } : {}),
  }));
  if (contactRows.length > 0) {
    const { error } = await admin
      .from("contacts")
      .upsert(contactRows, { onConflict: "user_id,address" });
    if (error) throw error;
  }

  // 3. Upsert threads and collect their ids.
  const threadRows = [...buckets.values()].map((b) => ({
    user_id: userId,
    participant_set: b.participants,
    participant_key: b.participantKey,
    last_message_at: b.lastMessageAt,
  }));

  const { data: upsertedThreads, error: threadError } = await admin
    .from("threads")
    .upsert(threadRows, { onConflict: "user_id,participant_key" })
    .select("id, participant_key");
  if (threadError) throw threadError;

  const threadIdByKey = new Map<string, string>();
  for (const t of upsertedThreads ?? []) {
    threadIdByKey.set(
      (t as { participant_key: string }).participant_key,
      (t as { id: string }).id,
    );
  }

  // 4. Link messages to their thread.
  let messagesLinked = 0;
  for (const bucket of buckets.values()) {
    const threadId = threadIdByKey.get(bucket.participantKey);
    if (!threadId) continue;
    const { error } = await admin
      .from("messages")
      .update({ thread_id: threadId })
      .in("id", bucket.messageIds);
    if (error) throw error;
    messagesLinked += bucket.messageIds.length;
  }

  return {
    threadsTouched: buckets.size,
    messagesLinked,
    contactsTouched: contactRows.length,
    threadIds: [...threadIdByKey.values()],
    contactAddresses: contactRows.map((c) => c.address),
  };
}

/**
 * Drop every thread for a user and unlink their messages, so the next backfill
 * re-derives all participant sets from scratch.
 *
 * Needed when the keying logic itself changes — e.g. adding Gmail alias
 * normalization, which means addresses previously treated as participants (the
 * user's own dotted address) must now be excluded. Existing rows would otherwise
 * keep their stale keys forever.
 *
 * Messages are untouched; only the derived grouping is rebuilt.
 */
export async function rebuildThreadsForUser(
  userId: string,
): Promise<ThreadingResult> {
  const admin = createAdminClient();

  const { error: unlinkError } = await admin
    .from("messages")
    .update({ thread_id: null })
    .eq("user_id", userId);
  if (unlinkError) throw unlinkError;

  const { error: deleteError } = await admin
    .from("threads")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw deleteError;

  return backfillThreadsForUser(userId);
}

/**
 * Re-derive threads for a user's messages that have no thread yet. Used to
 * backfill mail synced before threading existed, and safe to re-run.
 */
export async function backfillThreadsForUser(
  userId: string,
): Promise<ThreadingResult> {
  const admin = createAdminClient();

  // Process per account so each message is keyed against the right "self".
  const { data: accounts, error: accountsError } = await admin
    .from("email_accounts")
    .select("id, email")
    .eq("user_id", userId);
  if (accountsError) throw accountsError;

  const total: ThreadingResult = {
    threadsTouched: 0,
    messagesLinked: 0,
    contactsTouched: 0,
    threadIds: [],
    contactAddresses: [],
  };

  for (const account of accounts ?? []) {
    const { id, email } = account as { id: string; email: string };
    const { data: messages, error } = await admin
      .from("messages")
      .select("id, from_address, to_addresses, cc_addresses, internal_date")
      .eq("user_id", userId)
      .eq("email_account_id", id)
      .is("thread_id", null);
    if (error) throw error;

    const result = await groupMessagesIntoThreads(
      userId,
      email,
      (messages ?? []) as ThreadableMessage[],
    );
    total.threadsTouched += result.threadsTouched;
    total.messagesLinked += result.messagesLinked;
    total.contactsTouched += result.contactsTouched;
    total.threadIds.push(...result.threadIds);
    total.contactAddresses.push(...result.contactAddresses);
  }

  return total;
}
