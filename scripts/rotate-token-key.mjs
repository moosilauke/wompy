/**
 * Rotate the OAuth token encryption key: re-encrypt every row currently
 * under TOKEN_ENCRYPTION_KEY_PREVIOUS so it's under TOKEN_ENCRYPTION_KEY
 * instead.
 *
 * Runbook:
 *   1. Generate a new key:  openssl rand -base64 32
 *   2. In the deploy environment, move the current TOKEN_ENCRYPTION_KEY value
 *      to TOKEN_ENCRYPTION_KEY_PREVIOUS, and set TOKEN_ENCRYPTION_KEY to the
 *      new value. Deploy — the app now writes with the new key but can still
 *      read rows encrypted under the old one (see src/lib/crypto.ts).
 *   3. Run this script with --apply to bring every row onto the new key.
 *   4. Remove TOKEN_ENCRYPTION_KEY_PREVIOUS and deploy again.
 *
 * Idempotent: a row already decryptable only by the current key (no previous
 * key configured, or decrypting under the current key succeeds) is left
 * alone, so re-running mid-rotation or after completion is safe.
 *
 *   node scripts/rotate-token-key.mjs           # report what would change
 *   node scripts/rotate-token-key.mjs --apply   # write
 */

import { createClient } from "@supabase/supabase-js";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
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

function decodeKey(raw, envVarName) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    console.error(`${envVarName} is not set in .env.local.`);
    process.exit(1);
  }
  const key = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    console.error(`${envVarName} must decode to 32 bytes (got ${key.length}).`);
    process.exit(1);
  }
  return key;
}

const currentKey = decodeKey(env.TOKEN_ENCRYPTION_KEY, "TOKEN_ENCRYPTION_KEY");
const previousKeyRaw = (env.TOKEN_ENCRYPTION_KEY_PREVIOUS ?? "").trim();
if (!previousKeyRaw) {
  console.error(
    "TOKEN_ENCRYPTION_KEY_PREVIOUS is not set — nothing to rotate away from.\n" +
      "Set it to the OLD key value, and TOKEN_ENCRYPTION_KEY to the new one, then re-run.",
  );
  process.exit(1);
}
const previousKey = decodeKey(previousKeyRaw, "TOKEN_ENCRYPTION_KEY_PREVIOUS");

function encrypt(plaintext) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, currentKey, iv);
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

/** Returns null if `stored` doesn't decrypt under `key` (wrong key for this row). */
function tryDecrypt(stored, key) {
  const parts = stored.split(":");
  if (parts.length !== 4) return null;
  const [, ivPart, tagPart, dataPart] = parts;
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Re-encrypt one field under the current key if it's under the previous one.
 * Returns the new stored value, or null if no change is needed (already on
 * the current key, or not an encrypted value at all).
 */
function rotateField(stored) {
  if (!stored || !stored.startsWith(`${VERSION}:`)) return null;
  if (tryDecrypt(stored, currentKey) !== null) return null; // already current
  const plaintext = tryDecrypt(stored, previousKey);
  if (plaintext === null) {
    throw new Error(
      "value decrypts under neither the current nor the previous key",
    );
  }
  return encrypt(plaintext);
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

  try {
    const newAccess = rotateField(row.access_token);
    if (newAccess) update.access_token = newAccess;
    const newRefresh = rotateField(row.refresh_token);
    if (newRefresh) update.refresh_token = newRefresh;
  } catch (e) {
    console.error(`  ${row.email}: FAILED — ${e.message}`);
    process.exit(1);
  }

  if (Object.keys(update).length === 0) {
    console.log(`  ${row.email}: already on the current key`);
    continue;
  }

  changed += 1;
  console.log(`  ${row.email}: will rotate ${Object.keys(update).join(", ")}`);

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
    ? "\nNothing to do — every row is already on the current key."
    : apply
      ? `\nRotated ${changed} account(s) onto the current key.`
      : `\n${changed} account(s) would change. Re-run with --apply to write.`,
);
