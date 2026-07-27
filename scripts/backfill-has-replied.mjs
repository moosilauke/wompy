/**
 * One-off migration: populate contacts.has_replied from existing sent mail.
 *
 * groupMessagesIntoThreads (src/lib/email/threading.ts) sets has_replied
 * incrementally going forward, the moment a self-authored reply to a contact
 * is ingested. This backfills it once for contacts that already existed
 * before that column did — without this, a contact currently classified as
 * "Contact" purely by past reply-reciprocity could flip to "Company" on the
 * next classify run, since the signal would otherwise look absent.
 *
 * Per user: read every email_accounts row (the user's own addresses, so
 * "from me" can be recognized across every connected mailbox), then every
 * sent message's to/cc, and mark those contacts has_replied = true.
 *
 * canonicalAddress()/parseAddress() are duplicated here in plain JS rather
 * than imported — see backfill-from-canonical.mjs for the same pattern and
 * caveat: MUST be kept in sync with src/lib/email/addresses.ts.
 *
 * Idempotent: only ever sets has_replied to true, never back to false, so
 * running this twice is safe.
 *
 *   node scripts/backfill-has-replied.mjs           # report what would change
 *   node scripts/backfill-has-replied.mjs --apply   # write
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

// --- Duplicated from src/lib/email/addresses.ts — keep in sync. ---
const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

function parseAddress(raw) {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const angleStart = value.lastIndexOf("<");
  const angleEnd = value.lastIndexOf(">");
  if (angleStart !== -1 && angleEnd > angleStart) {
    const address = value.slice(angleStart + 1, angleEnd).trim().toLowerCase();
    return { address };
  }
  return { address: value.toLowerCase() };
}

function parseAddressList(raw) {
  if (!raw) return [];
  const out = [];
  for (const entry of raw) {
    const parsed = parseAddress(entry);
    if (parsed && parsed.address) out.push(parsed);
  }
  return out;
}

function canonicalAddress(raw) {
  const address = raw.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at === -1) return address;

  let local = address.slice(0, at);
  const domain = address.slice(at + 1);

  const plus = local.indexOf("+");
  if (plus !== -1) local = local.slice(0, plus);

  if (DOT_INSENSITIVE_DOMAINS.has(domain)) {
    local = local.replaceAll(".", "");
  }

  return `${local}@${domain}`;
}
// --- End duplicated section. ---

const apply = process.argv.includes("--apply");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const { data: users, error: usersError } = await db
  .from("email_accounts")
  .select("user_id, email");
if (usersError) {
  console.error("Failed to read email_accounts:", usersError.message);
  process.exit(1);
}

const selfAddressesByUser = new Map();
for (const row of users ?? []) {
  const set = selfAddressesByUser.get(row.user_id) ?? new Set();
  set.add(canonicalAddress(row.email));
  selfAddressesByUser.set(row.user_id, set);
}

let totalChanged = 0;

for (const [userId, selfAddresses] of selfAddressesByUser) {
  const { data: messages, error: messagesError } = await db
    .from("messages")
    .select("from_address, to_addresses, cc_addresses")
    .eq("user_id", userId);
  if (messagesError) {
    console.error(`Failed to read messages for user ${userId}:`, messagesError.message);
    process.exit(1);
  }

  const repliedTo = new Set();
  for (const row of messages ?? []) {
    const fromParsed = row.from_address ? parseAddress(row.from_address) : null;
    if (!fromParsed || !selfAddresses.has(canonicalAddress(fromParsed.address))) continue;

    for (const p of [
      ...parseAddressList(row.to_addresses),
      ...parseAddressList(row.cc_addresses),
    ]) {
      if (!selfAddresses.has(canonicalAddress(p.address))) {
        repliedTo.add(p.address);
      }
    }
  }

  if (repliedTo.size === 0) continue;

  // Only touch contacts that exist and aren't already flagged, so a re-run
  // reports/changes nothing.
  const { data: existing, error: contactsError } = await db
    .from("contacts")
    .select("address, has_replied")
    .eq("user_id", userId)
    .in("address", [...repliedTo]);
  if (contactsError) {
    console.error(`Failed to read contacts for user ${userId}:`, contactsError.message);
    process.exit(1);
  }

  const toUpdate = (existing ?? [])
    .filter((c) => !c.has_replied)
    .map((c) => c.address);
  if (toUpdate.length === 0) continue;

  totalChanged += toUpdate.length;
  console.log(`  user ${userId}: ${toUpdate.length} contact(s) -> has_replied = true`);

  if (apply) {
    const { error: updateError } = await db
      .from("contacts")
      .update({ has_replied: true })
      .eq("user_id", userId)
      .in("address", toUpdate);
    if (updateError) {
      console.error(`    FAILED: ${updateError.message}`);
      process.exit(1);
    }
  }
}

console.log(
  totalChanged === 0
    ? "\nNothing to do — has_replied already correct for every contact."
    : apply
      ? `\nSet has_replied on ${totalChanged} contact(s).`
      : `\n${totalChanged} contact(s) would change. Re-run with --apply to write.`,
);
