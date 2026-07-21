import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { canonicalAddress } from "@/lib/email/addresses";
import { tabForThread } from "@/lib/email/classifier";
import type { ContactTab } from "@/lib/types";

/**
 * Moving a conversation to a different tab, by hand.
 *
 * The classifier is rules-based and gets things wrong: a real person on a
 * corporate domain reads as a Company, a marketing address that happens to look
 * hand-composed reads as a Contact. Every such miss so far needed a code change
 * to fix, which is not a workable position for anyone who isn't the developer.
 *
 * An override is recorded on the CONTACT, not the thread, because the
 * classifier's unit of judgement is the sender: telling Wompy "SentinelOne is a
 * Company" should hold for every conversation with them, including ones that
 * arrive later. `classifyUserMail` already skips contacts with
 * `manually_overridden = true`, so the choice survives every future sync.
 */

export interface ReclassifyResult {
  contactsUpdated: number;
  threadsUpdated: number;
}

/**
 * Move a thread — and the people in it — to `tab`.
 *
 * The user's own address is excluded: they are a participant in every
 * conversation, and marking themselves would apply the override to the entire
 * mailbox.
 */
export async function reclassifyThread(
  userId: string,
  threadId: string,
  tab: ContactTab,
): Promise<ReclassifyResult> {
  const admin = createAdminClient();

  const { data: thread, error: threadError } = await admin
    .from("threads")
    .select("id, participant_set")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  if (threadError) throw threadError;
  if (!thread) throw new Error("Conversation not found.");

  const participants =
    (thread as { participant_set: string[] }).participant_set ?? [];

  const { data: accounts } = await admin
    .from("email_accounts")
    .select("email")
    .eq("user_id", userId);
  const selfAddresses = new Set(
    (accounts ?? []).map((a) => canonicalAddress((a as { email: string }).email)),
  );

  const targets = participants.filter(
    (address) => !selfAddresses.has(canonicalAddress(address)),
  );
  if (targets.length === 0) {
    return { contactsUpdated: 0, threadsUpdated: 0 };
  }

  // Record the choice against every participant, and lock it so the next
  // classify run leaves it alone.
  const { data: updatedContacts, error: contactError } = await admin
    .from("contacts")
    .update({
      tab,
      manually_overridden: true,
      classification_signals: {
        rule: "manual",
        reason: "You moved this sender here.",
        movedAt: new Date().toISOString(),
      },
    })
    .eq("user_id", userId)
    .in("address", targets)
    .select("id");
  if (contactError) throw contactError;

  // Re-derive tabs for every thread these people appear in, not just this one.
  // A sender moved to Companies should leave the chat view everywhere, and the
  // alternative — waiting for the next sync — would make the change look like
  // it silently failed.
  const threadsUpdated = await rederiveThreadsFor(userId, targets);

  return {
    contactsUpdated: updatedContacts?.length ?? 0,
    threadsUpdated,
  };
}

/**
 * Recompute `threads.tab` for every thread involving any of `addresses`.
 *
 * Uses the same `tabForThread` precedence as the classifier rather than writing
 * `tab` directly, so a group conversation containing one Contact stays a
 * Contact conversation — matching what the next sync would derive. Writing the
 * requested tab straight onto the thread would disagree with the classifier and
 * flip back later.
 */
async function rederiveThreadsFor(
  userId: string,
  addresses: string[],
): Promise<number> {
  const admin = createAdminClient();

  const { data: threads, error } = await admin
    .from("threads")
    .select("id, participant_set, tab")
    .eq("user_id", userId)
    .overlaps("participant_set", addresses);
  if (error) throw error;
  if (!threads || threads.length === 0) return 0;

  // Every participant across the affected threads, so their tabs can be read in
  // one query rather than per thread.
  const involved = new Set<string>();
  for (const t of threads as { participant_set: string[] }[]) {
    for (const address of t.participant_set ?? []) involved.add(address);
  }

  const { data: contacts } = await admin
    .from("contacts")
    .select("address, tab")
    .eq("user_id", userId)
    .in("address", [...involved]);

  const tabByAddress = new Map(
    (contacts ?? []).map((c) => {
      const row = c as { address: string; tab: ContactTab };
      return [row.address, row.tab];
    }),
  );

  const updates: { id: string; tab: ContactTab }[] = [];
  for (const t of threads as {
    id: string;
    participant_set: string[];
    tab: ContactTab;
  }[]) {
    const tabs = (t.participant_set ?? []).map(
      (address) => tabByAddress.get(address) ?? "company",
    );
    const next = tabForThread(tabs);
    if (next !== t.tab) updates.push({ id: t.id, tab: next });
  }

  if (updates.length === 0) return 0;

  const { error: rpcError } = await admin.rpc("apply_thread_tabs", {
    p_user_id: userId,
    p_updates: updates,
  });
  if (rpcError) throw rpcError;

  return updates.length;
}
