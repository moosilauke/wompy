import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { canonicalAddress, parseAddressList } from "@/lib/email/addresses";
import {
  classifySender,
  isMailClientMessageId,
  tabForThread,
} from "@/lib/email/classifier";
import type { ContactTab } from "@/lib/types";

/**
 * Applies the classifier across a user's synced mail and persists the results.
 *
 * Runs after threading at the end of each sync. Idempotent — re-running
 * re-derives the same answers from the same data.
 *
 * Manual overrides are respected absolutely: a contact with
 * `manually_overridden = true` is never reclassified, so automation can't fight
 * an explicit user choice.
 */

const SPAM_LABEL = "SPAM";

export interface ClassifyRunResult {
  contactsClassified: number;
  contactsSkippedOverridden: number;
  threadsUpdated: number;
}

/**
 * Restricts a classify run to specific contacts/threads instead of the whole
 * mailbox. Omit (or pass nothing) to fall back to the original full-mailbox
 * scan — used by the manual "reclassify everything" / `?rebuild=1` path,
 * where re-deriving every row is the actual point.
 *
 * Scoping changes which CONTACTS get (re)classified and which THREADS get
 * their tab re-derived. A scoped contact's OWN messages (list-unsubscribe
 * headers, spam labels, mail-client message-ids) are matched via
 * `from_canonical` (migration 0018), so the message read stays scoped too —
 * reply-reciprocity used to require an unscoped scan of everything the user
 * ever sent, but is now read directly off `contacts.has_replied`, maintained
 * incrementally at ingest time (migration 0019), so it no longer forces a
 * full scan either.
 */
export interface ClassifyScope {
  contactAddresses?: string[];
  threadIds?: string[];
}

export async function classifyUserMail(
  userId: string,
  scope?: ClassifyScope,
): Promise<ClassifyRunResult> {
  const admin = createAdminClient();

  // 0. The user's own addresses — the basis for "did I write this".
  //
  //    Gmail's SENT label cannot be used for this. When you correspond with
  //    another account you own, Gmail returns SENT on the *inbound* copy as
  //    well, so trusting it made every counterparty look like the user: their
  //    mail counted as the user's own replies, and they were skipped when
  //    classifying senders. The From address, canonicalized, is authoritative.
  //    Read alongside the message/contact/thread queries below rather than
  //    before them: nothing in those depends on it, and this runs on every
  //    classify call — including one per backfill step, roughly once a second
  //    during an import, where a serialized extra round-trip is pure cost.
  const contactsFilter = scope?.contactAddresses;
  const threadsFilter = scope?.threadIds;

  // 1. One pass over the relevant messages, serving the per-sender header
  //    merge below. This was two full-table scans; the second also selected
  //    `raw_headers` whole, which was 171KB of DKIM/ARC signature blocks to
  //    read three keys. Only the three keys the classifier actually consults
  //    are projected, server-side.
  //
  //    Reply-reciprocity is NOT derived here anymore — it used to require
  //    scanning every message the user ever sent, on every run, regardless of
  //    scope (see migration 0019). contacts.has_replied is now maintained
  //    incrementally by groupMessagesIntoThreads at ingest time, so this read
  //    can be scoped like everything else.
  //
  //    Fetched alongside the contact and thread rows, which are independent of
  //    it — only the writes further down depend on both.
  const [
    { data: messageRows, error: messagesError },
    { data: contacts, error: contactsError },
    { data: threads, error: threadsError },
    { data: accountRows, error: accountsError },
  ] = await Promise.all([
    contactsFilter
      ? admin
          .from("messages")
          .select(
            "from_address, label_ids," +
              "list_unsubscribe:raw_headers->>list-unsubscribe," +
              "precedence:raw_headers->>precedence," +
              "message_id:raw_headers->>message-id",
          )
          .eq("user_id", userId)
          // from_canonical (not from_address, which is the raw header) so
          // this matches contacts.address's canonical form exactly. See
          // migration 0018.
          .in("from_canonical", contactsFilter)
      : admin
          .from("messages")
          .select(
            "from_address, label_ids," +
              "list_unsubscribe:raw_headers->>list-unsubscribe," +
              "precedence:raw_headers->>precedence," +
              "message_id:raw_headers->>message-id",
          )
          .eq("user_id", userId),
    contactsFilter
      ? admin
          .from("contacts")
          .select("id, address, manually_overridden, tab, has_replied")
          .eq("user_id", userId)
          .in("address", contactsFilter)
      : admin
          .from("contacts")
          .select("id, address, manually_overridden, tab, has_replied")
          .eq("user_id", userId),
    threadsFilter
      ? admin
          .from("threads")
          .select("id, participant_set, tab")
          .eq("user_id", userId)
          .in("id", threadsFilter)
      : admin
          .from("threads")
          .select("id, participant_set, tab")
          .eq("user_id", userId),
    admin.from("email_accounts").select("email").eq("user_id", userId),
  ]);
  if (messagesError) throw messagesError;
  if (contactsError) throw contactsError;
  if (threadsError) throw threadsError;
  if (accountsError) throw accountsError;

  const selfAddresses = new Set(
    (accountRows ?? []).map((a) =>
      canonicalAddress((a as { email: string }).email),
    ),
  );

  const isFromSelf = (fromAddress: string | null): boolean => {
    const [parsed] = parseAddressList(fromAddress ? [fromAddress] : null);
    return parsed ? selfAddresses.has(canonicalAddress(parsed.address)) : false;
  };

  type MessageRow = {
    from_address: string | null;
    label_ids: string[] | null;
    list_unsubscribe: string | null;
    precedence: string | null;
    message_id: string | null;
  };

  // Cast through unknown: the generated types don't model PostgREST's
  // `alias:column->>key` JSON projection, so they infer a string-error shape.
  const allMessages = (messageRows ?? []) as unknown as MessageRow[];

  // 2. Merge the signals seen from each sender. A sender is judged on the union
  //    of their messages, so one bulk-flagged message marks the sender.
  const headersByAddress = new Map<string, Record<string, string>>();
  const spamAddresses = new Set<string>();
  // Tracked per-sender rather than read off the merged headers: the merge keeps
  // the first value seen for each header, so a sender's stored message-id would
  // be an arbitrary one of their messages. Any single message composed in a mail
  // client is enough to mark the sender as a person.
  const mailClientAddresses = new Set<string>();
  for (const row of allMessages) {
    const labels = row.label_ids ?? [];
    // Skip our own sent mail when judging senders — by From address, not the
    // SENT label (see note above).
    if (isFromSelf(row.from_address)) continue;
    const [parsed] = parseAddressList(row.from_address ? [row.from_address] : null);
    if (!parsed) continue;

    if (labels.includes(SPAM_LABEL)) spamAddresses.add(parsed.address);

    if (isMailClientMessageId(row.message_id ?? undefined)) {
      mailClientAddresses.add(parsed.address);
    }

    // Only the headers the classifier reads. Keep the first non-empty value
    // seen per sender, matching the previous merge semantics.
    const merged = headersByAddress.get(parsed.address) ?? {};
    if (row.list_unsubscribe && !merged["list-unsubscribe"]) {
      merged["list-unsubscribe"] = row.list_unsubscribe;
    }
    if (row.precedence && !merged["precedence"]) {
      merged["precedence"] = row.precedence;
    }
    headersByAddress.set(parsed.address, merged);
  }

  // 3. Classify each known contact, skipping manual overrides.
  let contactsClassified = 0;
  let contactsSkippedOverridden = 0;
  const tabByAddress = new Map<string, ContactTab>();

  // Classification itself is pure and in-memory; only the writes touch the
  // database, and they go out as a single batch. Updating row-by-row here cost
  // ~150ms per contact in round-trips alone (~3.4s for 22 contacts) and grew
  // linearly with the mailbox.
  const contactUpdates: {
    id: string;
    tab: ContactTab;
    classification_signals: ReturnType<typeof classifySender>["signals"];
  }[] = [];

  for (const contact of (contacts ?? []) as {
    id: string;
    address: string;
    manually_overridden: boolean;
    tab: ContactTab;
    has_replied: boolean;
  }[]) {
    if (contact.manually_overridden) {
      contactsSkippedOverridden += 1;
      // The tab is already on the row we just fetched — no re-read needed.
      tabByAddress.set(contact.address, contact.tab);
      continue;
    }

    const result = classifySender({
      address: contact.address,
      headers: headersByAddress.get(contact.address) ?? {},
      hasReplied: contact.has_replied,
      markedSpam: spamAddresses.has(contact.address),
      usesMailClient: mailClientAddresses.has(contact.address),
    });

    // Skip writes that wouldn't change anything — on a settled mailbox most
    // syncs then write nothing at all.
    if (contact.tab !== result.tab) {
      contactUpdates.push({
        id: contact.id,
        tab: result.tab,
        classification_signals: result.signals,
      });
    }

    tabByAddress.set(contact.address, result.tab);
    contactsClassified += 1;
  }

  if (contactUpdates.length > 0) {
    const { error } = await admin.rpc("apply_contact_tabs", {
      p_user_id: userId,
      p_updates: contactUpdates,
    });
    if (error) throw error;
  }

  // 4. Derive each thread's tab from its participants. A thread with any
  //    Contact participant is a conversation, not a newsletter.
  //
  //    tabByAddress only has entries for contacts in `contactsFilter` (or
  //    every contact, unscoped). A scoped thread can include a participant who
  //    wasn't in that scope — e.g. a group thread where only one of several
  //    participants had new mail this run — and defaulting a merely-unscoped
  //    participant to "company" would silently mis-tag threads with a real
  //    Contact in them. So: look up every scoped thread's participants that
  //    are still missing from tabByAddress, in one extra targeted query,
  //    before deriving tabs. Bounded by "participants of the threads actually
  //    in scope", not the whole mailbox.
  const typedThreads = (threads ?? []) as {
    id: string;
    participant_set: string[];
    tab: ContactTab;
  }[];

  if (threadsFilter) {
    const missing = new Set<string>();
    for (const thread of typedThreads) {
      for (const address of thread.participant_set ?? []) {
        if (!tabByAddress.has(address)) missing.add(address);
      }
    }
    if (missing.size > 0) {
      const { data: extraContacts, error: extraError } = await admin
        .from("contacts")
        .select("address, tab")
        .eq("user_id", userId)
        .in("address", [...missing]);
      if (extraError) throw extraError;
      for (const c of (extraContacts ?? []) as { address: string; tab: ContactTab }[]) {
        tabByAddress.set(c.address, c.tab);
      }
    }
  }

  // Batched for the same reason as the contact writes above.
  const threadUpdates: { id: string; tab: ContactTab }[] = [];
  for (const thread of typedThreads) {
    const tabs = (thread.participant_set ?? []).map(
      (address) => tabByAddress.get(address) ?? "company",
    );
    const tab = tabForThread(tabs);
    if (tab !== thread.tab) threadUpdates.push({ id: thread.id, tab });
  }

  if (threadUpdates.length > 0) {
    const { error } = await admin.rpc("apply_thread_tabs", {
      p_user_id: userId,
      p_updates: threadUpdates,
    });
    if (error) throw error;
  }

  // Counts rows actually changed, not rows examined.
  const threadsUpdated = threadUpdates.length;

  return {
    contactsClassified,
    contactsSkippedOverridden,
    threadsUpdated,
  };
}
