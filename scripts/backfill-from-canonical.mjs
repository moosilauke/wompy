/**
 * One-off migration: populate messages.from_canonical for rows synced before
 * that column existed.
 *
 * New rows get it from mapMessageToRow (src/lib/gmail/sync.ts) going forward.
 * This backfills everything already in the table so classify-run.ts's scoped
 * message read (WHERE from_canonical = ...) doesn't miss older mail.
 *
 * canonicalAddress()/parseAddress() are duplicated here in plain JS rather
 * than imported, since this runs outside the Next.js/TS toolchain (see
 * encrypt-tokens.mjs for the same pattern). MUST be kept in sync with
 * src/lib/email/addresses.ts if that logic ever changes.
 *
 * Idempotent: only rows where from_canonical is still null are touched, so
 * running this twice is safe (and cheap the second time).
 *
 *   node scripts/backfill-from-canonical.mjs           # report what would change
 *   node scripts/backfill-from-canonical.mjs --apply   # write
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

// Read .env.local directly so this runs without the Next.js runtime.
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

function fromCanonicalFor(fromAddress) {
  if (!fromAddress) return null;
  const parsed = parseAddress(fromAddress);
  return canonicalAddress(parsed?.address ?? fromAddress);
}

const apply = process.argv.includes("--apply");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const PAGE_SIZE = 1000;
let processed = 0;
let changed = 0;
let cursor = null;

for (;;) {
  let query = db
    .from("messages")
    .select("id, from_address")
    .is("from_canonical", null)
    .order("id", { ascending: true })
    .limit(PAGE_SIZE);
  if (cursor) query = query.gt("id", cursor);

  const { data: rows, error } = await query;
  if (error) {
    console.error("Failed to read messages:", error.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) break;

  const updatesByCanonical = new Map();
  for (const row of rows) {
    const canonical = fromCanonicalFor(row.from_address);
    if (!canonical) continue;
    if (!updatesByCanonical.has(canonical)) updatesByCanonical.set(canonical, []);
    updatesByCanonical.get(canonical).push(row.id);
  }

  processed += rows.length;
  cursor = rows[rows.length - 1].id;

  for (const [canonical, ids] of updatesByCanonical) {
    changed += ids.length;
    console.log(`  ${canonical}: ${ids.length} message(s)`);
    if (apply) {
      const { error: updateError } = await db
        .from("messages")
        .update({ from_canonical: canonical })
        .in("id", ids);
      if (updateError) {
        console.error(`    FAILED: ${updateError.message}`);
        process.exit(1);
      }
    }
  }

  if (rows.length < PAGE_SIZE) break;
}

console.log(
  changed === 0
    ? `\nNothing to do — all ${processed} row(s) already had from_canonical.`
    : apply
      ? `\nBackfilled from_canonical on ${changed} of ${processed} row(s) scanned.`
      : `\n${changed} of ${processed} row(s) scanned would change. Re-run with --apply to write.`,
);
