/**
 * One-off migration: encrypt any OAuth tokens still stored in plaintext.
 *
 * Rows written before encryption existed hold raw tokens. `decryptToken` passes
 * those through unchanged so sync keeps working, but they should not stay that
 * way — the point of encrypting is that the database alone is not enough.
 *
 * Idempotent: already-encrypted values carry a `v1:` prefix and are skipped, so
 * running this twice is safe.
 *
 *   node scripts/encrypt-tokens.mjs           # report what would change
 *   node scripts/encrypt-tokens.mjs --apply   # write
 */

import { createClient } from "@supabase/supabase-js";
import { createCipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

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

const rawKey = (env.TOKEN_ENCRYPTION_KEY ?? "").trim();
if (!rawKey) {
  console.error(
    "TOKEN_ENCRYPTION_KEY is not set in .env.local.\n" +
      "Generate one with:  openssl rand -base64 32",
  );
  process.exit(1);
}

const key = /^[0-9a-f]{64}$/i.test(rawKey)
  ? Buffer.from(rawKey, "hex")
  : Buffer.from(rawKey, "base64");

if (key.length !== 32) {
  console.error(
    `TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}).`,
  );
  process.exit(1);
}

function encrypt(plaintext) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

const apply = process.argv.includes("--apply");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const { data: rows, error } = await db
  .from("email_accounts")
  .select("id, email, access_token, refresh_token");
if (error) {
  console.error("Failed to read email_accounts:", error.message);
  process.exit(1);
}

let changed = 0;
for (const row of rows ?? []) {
  const update = {};

  if (row.access_token && !row.access_token.startsWith(`${VERSION}:`)) {
    update.access_token = encrypt(row.access_token);
  }
  if (row.refresh_token && !row.refresh_token.startsWith(`${VERSION}:`)) {
    update.refresh_token = encrypt(row.refresh_token);
  }

  if (Object.keys(update).length === 0) {
    console.log(`  ${row.email}: already encrypted`);
    continue;
  }

  changed += 1;
  console.log(
    `  ${row.email}: will encrypt ${Object.keys(update).join(", ")}`,
  );

  if (apply) {
    const { error: e } = await db
      .from("email_accounts")
      .update(update)
      .eq("id", row.id);
    if (e) {
      console.error(`    FAILED: ${e.message}`);
      process.exit(1);
    }
  }
}

console.log(
  changed === 0
    ? "\nNothing to do — all tokens are encrypted."
    : apply
      ? `\nEncrypted tokens on ${changed} account(s).`
      : `\n${changed} account(s) would change. Re-run with --apply to write.`,
);
