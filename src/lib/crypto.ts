import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Encryption at rest for third-party OAuth tokens.
 *
 * A Gmail refresh token grants ongoing access to someone's entire mailbox. In
 * plaintext, anyone who reaches the database — a leaked backup, a stolen
 * service key, an over-broad support query — reads every user's mail. Encrypting
 * with a key held outside the database means a database compromise alone is not
 * enough.
 *
 * AES-256-GCM specifically: it authenticates as well as encrypts, so a modified
 * ciphertext fails loudly instead of decrypting to plausible garbage that would
 * then be sent to Google as a credential.
 *
 * Stored format is `v1:<iv>:<authTag>:<ciphertext>`, all base64url. The version
 * prefix is what makes key rotation possible later without guessing at how an
 * existing value was produced.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
/** 96 bits — the size GCM is specified for, and what Node's GCM expects. */
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

/**
 * The encryption key, derived once per process.
 *
 * Accepts base64 or hex so operators aren't forced into one encoding, but
 * requires the decoded value to be exactly 32 bytes — a short key would
 * silently weaken every token, so it fails at startup instead.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = serverEnv.tokenEncryptionKey.trim();

  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }

  cachedKey = key;
  return key;
}

/** True when a stored value is already in the encrypted envelope format. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}:`);
}

/**
 * Encrypt a token for storage. Returns null for null/empty input so callers can
 * pass optional fields straight through.
 */
export function encryptToken(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

/**
 * Decrypt a stored token.
 *
 * Values without the version prefix are returned as-is: rows written before
 * encryption existed are still plaintext, and refusing to read them would break
 * sync for every existing account. `npm run encrypt-tokens` migrates them.
 */
export function decryptToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!isEncrypted(stored)) return stored;

  const parts = stored.split(":");
  if (parts.length !== 4) {
    throw new Error("Stored token is malformed (expected 4 segments).");
  }

  const [, ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Constant-time string comparison, for anywhere a secret is checked against a
 * user-supplied value. Exported here so the primitive lives with the rest of
 * the crypto rather than being reimplemented with `===`.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
