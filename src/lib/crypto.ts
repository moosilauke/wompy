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
 * prefix identifies the scheme (AES-256-GCM, this envelope shape) — it does not
 * change on key rotation, since rotation swaps the key, not the format.
 *
 * Key rotation: `decryptToken` tries `TOKEN_ENCRYPTION_KEY` first, then
 * `TOKEN_ENCRYPTION_KEY_PREVIOUS` if set, so rows re-encrypted at different
 * times all keep decrypting during a rotation window. GCM's auth tag is the
 * correctness check — the wrong key fails loudly instead of decrypting to
 * garbage. See `scripts/rotate-token-key.mjs` for the migration that brings
 * every row onto the new key so the previous one can be retired.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
/** 96 bits — the size GCM is specified for, and what Node's GCM expects. */
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Decode a raw TOKEN_ENCRYPTION_KEY value (base64 or hex) into the 32-byte
 * buffer AES-256 needs. Exported so the rotation script can decode both the
 * current and previous key the same way this module does.
 */
export function decodeKey(raw: string, envVarName: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${envVarName} must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }

  return key;
}

let cachedKey: Buffer | null = null;
let cachedPreviousKey: Buffer | null | undefined;

/** The current encryption key, derived once per process. All new writes use this. */
function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = decodeKey(serverEnv.tokenEncryptionKey, "TOKEN_ENCRYPTION_KEY");
  }
  return cachedKey;
}

/**
 * The previous key, if a rotation is in progress. `undefined` means "not
 * derived yet", `null` means "derived, and none is configured" — distinct
 * from each other so we only decode once either way.
 */
function getPreviousKey(): Buffer | null {
  if (cachedPreviousKey === undefined) {
    const raw = serverEnv.tokenEncryptionKeyPrevious;
    cachedPreviousKey = raw
      ? decodeKey(raw, "TOKEN_ENCRYPTION_KEY_PREVIOUS")
      : null;
  }
  return cachedPreviousKey;
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

function decryptWithKey(key: Buffer, ivPart: string, tagPart: string, dataPart: string): string {
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
}

/**
 * Decrypt a stored token.
 *
 * Values without the version prefix are returned as-is: rows written before
 * encryption existed are still plaintext, and refusing to read them would break
 * sync for every existing account. `npm run encrypt-tokens` migrates them.
 *
 * Tries the current key first, then `TOKEN_ENCRYPTION_KEY_PREVIOUS` (if set)
 * so a key rotation in progress doesn't break rows that haven't been
 * re-encrypted yet. See `scripts/rotate-token-key.mjs`.
 */
export function decryptToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!isEncrypted(stored)) return stored;

  const parts = stored.split(":");
  if (parts.length !== 4) {
    throw new Error("Stored token is malformed (expected 4 segments).");
  }

  const [, ivPart, tagPart, dataPart] = parts;

  try {
    return decryptWithKey(getKey(), ivPart, tagPart, dataPart);
  } catch (err) {
    const previousKey = getPreviousKey();
    if (!previousKey) throw err;
    return decryptWithKey(previousKey, ivPart, tagPart, dataPart);
  }
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
