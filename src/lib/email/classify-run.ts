import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { canonicalAddress, parseAddressList } from "@/lib/email/addresses";
import { classifySender, tabForThread } from "@/lib/email/classifier";
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

const SENT_LABEL = "SENT";
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

  // 1. Addresses the user has sent mail TO — the reply-reciprocity signal.
  //    Uses Gmail's SENT label rather than matching the From address, which is
  //    brittle across aliases and +suffixes.
  const { data: sentRows, error: sentError } = await admin
    .from("messages")
    .select("to_addresses, cc_addresses")
    .eq("user_id", userId)
    .contains("label_ids", [SENT_LABEL]);
  if (sentError) throw sentError;

  // Stored canonically so a reply sent to any alias form still matches.
  const repliedTo = new Set<string>();
  for (const row of (sentRows ?? []) as {
    to_addresses: string[] | null;
    cc_addresses: string[] | null;
  }[]) {
    for (const p of parseAddressList(row.to_addresses)) {
      repliedTo.add(canonicalAddress(p.address));
    }
    for (const p of parseAddressList(row.cc_addresses)) {
      repliedTo.add(canonicalAddress(p.address));
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
  for (const row of (received ?? []) as {
    from_address: string | null;
    raw_headers: Record<string, string>;
    label_ids: string[] | null;
  }[]) {
    const labels = row.label_ids ?? [];
    // Skip our own sent mail when judging senders.
    if (labels.includes(SENT_LABEL)) continue;
    const [parsed] = parseAddressList(row.from_address ? [row.from_address] : null);
    if (!parsed) continue;

    if (labels.includes(SPAM_LABEL)) spamAddresses.add(parsed.address);

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
    .select("id, address, manually_overridden")
    .eq("user_id", userId);
  if (contactsError) throw contactsError;

  let contactsClassified = 0;
  let contactsSkippedOverridden = 0;
  const tabByAddress = new Map<string, ContactTab>();

  for (const contact of (contacts ?? []) as {
    id: string;
    address: string;
    manually_overridden: boolean;
  }[]) {
    if (contact.manually_overridden) {
      contactsSkippedOverridden += 1;
      // Still need its tab for thread derivation below.
      const { data: existing } = await admin
        .from("contacts")
        .select("tab")
        .eq("id", contact.id)
        .single();
      if (existing) {
        tabByAddress.set(
          contact.address,
          (existing as { tab: ContactTab }).tab,
        );
      }
      continue;
    }

    const result = classifySender({
      address: contact.address,
      headers: headersByAddress.get(contact.address) ?? {},
      hasReplied: repliedTo.has(canonicalAddress(contact.address)),
      markedSpam: spamAddresses.has(contact.address),
    });

    const { error } = await admin
      .from("contacts")
      .update({
        tab: result.tab,
        classification_signals: result.signals,
      })
      .eq("id", contact.id);
    if (error) throw error;

    tabByAddress.set(contact.address, result.tab);
    contactsClassified += 1;
  }

  // 4. Derive each thread's tab from its participants. A thread with any
  //    Contact participant is a conversation, not a newsletter.
  const { data: threads, error: threadsError } = await admin
    .from("threads")
    .select("id, participant_set")
    .eq("user_id", userId);
  if (threadsError) throw threadsError;

  let threadsUpdated = 0;
  for (const thread of (threads ?? []) as {
    id: string;
    participant_set: string[];
  }[]) {
    const tabs = (thread.participant_set ?? []).map(
      (address) => tabByAddress.get(address) ?? "company",
    );
    const tab = tabForThread(tabs);

    const { error } = await admin
      .from("threads")
      .update({ tab })
      .eq("id", thread.id);
    if (error) throw error;
    threadsUpdated += 1;
  }

  return {
    contactsClassified,
    contactsSkippedOverridden,
    threadsUpdated,
  };
}
