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

export async function classifyUserMail(
  userId: string,
): Promise<ClassifyRunResult> {
  const admin = createAdminClient();

  // 0. The user's own addresses — the basis for "did I write this".
  //
  //    Gmail's SENT label cannot be used for this. When you correspond with
  //    another account you own, Gmail returns SENT on the *inbound* copy as
  //    well, so trusting it made every counterparty look like the user: their
  //    mail counted as the user's own replies, and they were skipped when
  //    classifying senders. The From address, canonicalized, is authoritative.
  const { data: accountRows, error: accountsError } = await admin
    .from("email_accounts")
    .select("email")
    .eq("user_id", userId);
  if (accountsError) throw accountsError;

  const selfAddresses = new Set(
    (accountRows ?? []).map((a) => canonicalAddress((a as { email: string }).email)),
  );

  const isFromSelf = (fromAddress: string | null): boolean => {
    const [parsed] = parseAddressList(fromAddress ? [fromAddress] : null);
    return parsed ? selfAddresses.has(canonicalAddress(parsed.address)) : false;
  };

  // 1. Addresses the user has sent mail TO — the reply-reciprocity signal.
  const { data: sentCandidates, error: sentError } = await admin
    .from("messages")
    .select("from_address, to_addresses, cc_addresses")
    .eq("user_id", userId);
  if (sentError) throw sentError;

  const sentRows = (sentCandidates ?? []).filter((row) =>
    isFromSelf((row as { from_address: string | null }).from_address),
  );

  // Stored canonically so a reply sent to any alias form still matches. The
  // user's own addresses are excluded so self-addressed mail doesn't make them
  // their own contact.
  const repliedTo = new Set<string>();
  for (const row of sentRows as {
    to_addresses: string[] | null;
    cc_addresses: string[] | null;
  }[]) {
    for (const p of [
      ...parseAddressList(row.to_addresses),
      ...parseAddressList(row.cc_addresses),
    ]) {
      const canonical = canonicalAddress(p.address);
      if (!selfAddresses.has(canonical)) repliedTo.add(canonical);
    }
  }

  // 2. Merge the headers seen from each sender. A sender is judged on the union
  //    of their headers, so one bulk-flagged message marks the sender.
  const { data: received, error: receivedError } = await admin
    .from("messages")
    .select("from_address, raw_headers, label_ids")
    .eq("user_id", userId);
  if (receivedError) throw receivedError;

  const headersByAddress = new Map<string, Record<string, string>>();
  const spamAddresses = new Set<string>();
  // Tracked per-sender rather than read off the merged headers: the merge keeps
  // the first value seen for each header, so a sender's stored message-id would
  // be an arbitrary one of their messages. Any single message composed in a mail
  // client is enough to mark the sender as a person.
  const mailClientAddresses = new Set<string>();
  for (const row of (received ?? []) as {
    from_address: string | null;
    raw_headers: Record<string, string>;
    label_ids: string[] | null;
  }[]) {
    const labels = row.label_ids ?? [];
    // Skip our own sent mail when judging senders — by From address, not the
    // SENT label (see note above).
    if (isFromSelf(row.from_address)) continue;
    const [parsed] = parseAddressList(row.from_address ? [row.from_address] : null);
    if (!parsed) continue;

    if (labels.includes(SPAM_LABEL)) spamAddresses.add(parsed.address);

    if (isMailClientMessageId(row.raw_headers?.["message-id"])) {
      mailClientAddresses.add(parsed.address);
    }

    const merged = headersByAddress.get(parsed.address) ?? {};
    for (const [k, v] of Object.entries(row.raw_headers ?? {})) {
      // Keep the first non-empty value seen for each header.
      if (v && !merged[k]) merged[k] = v;
    }
    headersByAddress.set(parsed.address, merged);
  }

  // 3. Classify each known contact, skipping manual overrides.
  const { data: contacts, error: contactsError } = await admin
    .from("contacts")
    // `tab` is selected so overridden rows need no re-read, and so unchanged
    // rows can be skipped instead of rewritten.
    .select("id, address, manually_overridden, tab")
    .eq("user_id", userId);
  if (contactsError) throw contactsError;

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
      hasReplied: repliedTo.has(canonicalAddress(contact.address)),
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
  const { data: threads, error: threadsError } = await admin
    .from("threads")
    // `tab` selected so unchanged threads can be skipped.
    .select("id, participant_set, tab")
    .eq("user_id", userId);
  if (threadsError) throw threadsError;

  // Batched for the same reason as the contact writes above.
  const threadUpdates: { id: string; tab: ContactTab }[] = [];
  for (const thread of (threads ?? []) as {
    id: string;
    participant_set: string[];
    tab: ContactTab;
  }[]) {
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
