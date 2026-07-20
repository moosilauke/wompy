/**
 * Email address parsing and participant-set thread keying.
 *
 * Pure module — no DB or network imports — so the classifier (next step) and any
 * tests can reuse it freely.
 *
 * Gmail stores addresses in mixed shapes: `"Kindertales <no-reply@kindertales.com>"`,
 * a bare `kevincole@gmail.com`, or a quoted name `"Cole, Kevin" <k@x.com>`.
 * Everything downstream needs the bare, lowercased address, so normalize once here.
 */

export interface ParsedAddress {
  /** Bare, lowercased address, e.g. "no-reply@kindertales.com". */
  address: string;
  /** Display name if one was present, e.g. "Kindertales". */
  displayName: string | null;
}

/**
 * Parse a single address header value into its address and display name.
 * Returns null when no plausible address is present (empty/garbage input).
 */
export function parseAddress(raw: string | null | undefined): ParsedAddress | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  // "Display Name <addr@host>" — take the last <...> in case the name contains one.
  const angleStart = value.lastIndexOf("<");
  const angleEnd = value.lastIndexOf(">");
  if (angleStart !== -1 && angleEnd > angleStart) {
    const address = value.slice(angleStart + 1, angleEnd).trim().toLowerCase();
    const namePart = value.slice(0, angleStart).trim();
    return {
      address,
      displayName: cleanDisplayName(namePart),
    };
  }

  // Bare address.
  return { address: value.toLowerCase(), displayName: null };
}

/** Strip surrounding quotes and collapse whitespace; empty becomes null. */
function cleanDisplayName(name: string): string | null {
  const unquoted = name.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ");
  return unquoted.length > 0 ? unquoted : null;
}

/** Parse a list of raw address strings, dropping unparseable entries. */
export function parseAddressList(
  raw: string[] | null | undefined,
): ParsedAddress[] {
  if (!raw) return [];
  const out: ParsedAddress[] = [];
  for (const entry of raw) {
    const parsed = parseAddress(entry);
    if (parsed && parsed.address) out.push(parsed);
  }
  return out;
}

/** Domains where dots in the local part are insignificant and `+` starts a tag. */
const DOT_INSENSITIVE_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
]);

/**
 * Canonical form of an address for identity comparison.
 *
 * Gmail ignores dots and treats everything after `+` as a tag, so
 * `kevin.cole@gmail.com`, `kevincole@gmail.com`, and `kevincole+news@gmail.com`
 * are all the same mailbox. Without this, the user's own address fails to match
 * their connected account: they end up as their own "contact", pollute
 * participant sets, and flip thread tabs.
 *
 * Plus-tags are stripped on every domain (near-universal); dot-stripping is
 * limited to domains where it actually applies.
 */
export function canonicalAddress(raw: string): string {
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

/** True when both addresses resolve to the same mailbox. */
export function sameMailbox(a: string, b: string): boolean {
  return canonicalAddress(a) === canonicalAddress(b);
}

export interface ParticipantSet {
  /** Sorted, de-duplicated, lowercased addresses excluding the user. */
  participants: string[];
  /** Canonical key for the `threads.participant_key` unique constraint. */
  participantKey: string;
}

/**
 * Build the thread key from every address on a message.
 *
 * Per the MVP threading model, the key is the sorted set of participants
 * EXCLUDING the user — a group-chat model, not "whoever started it". A 1:1 thread
 * and a 3-person thread sharing two participants are therefore distinct threads.
 *
 * Self-addressed mail (the user is the only participant) still needs a thread, so
 * it falls back to the user's own address rather than an empty set.
 */
export function buildParticipantSet(
  addresses: string[],
  selfAddress: string,
): ParticipantSet {
  const self = selfAddress.trim().toLowerCase();
  // Compare canonically so alias forms of the user's own address (dots,
  // +tags) are recognized as self and excluded from the participant set.
  const selfCanonical = canonicalAddress(self);

  const unique = new Set<string>();
  for (const a of addresses) {
    const normalized = a.trim().toLowerCase();
    if (!normalized) continue;
    if (canonicalAddress(normalized) === selfCanonical) continue;
    unique.add(normalized);
  }

  // Mail to yourself: keep the user as the sole participant so it still threads.
  if (unique.size === 0) unique.add(self);

  const participants = [...unique].sort();
  return {
    participants,
    // Newline join matches the `participant_key` column written by migration 0001.
    participantKey: participants.join("\n"),
  };
}

/**
 * Collect every participant address on a message (from + to + cc) as bare
 * lowercased addresses, preserving the best display name seen per address.
 */
export function collectParticipants(message: {
  from_address: string | null;
  to_addresses: string[] | null;
  cc_addresses: string[] | null;
}): ParsedAddress[] {
  const parsed = [
    ...parseAddressList(message.from_address ? [message.from_address] : null),
    ...parseAddressList(message.to_addresses),
    ...parseAddressList(message.cc_addresses),
  ];

  // De-duplicate by address, keeping the first non-null display name found.
  const byAddress = new Map<string, ParsedAddress>();
  for (const p of parsed) {
    const existing = byAddress.get(p.address);
    if (!existing) {
      byAddress.set(p.address, p);
    } else if (!existing.displayName && p.displayName) {
      byAddress.set(p.address, p);
    }
  }
  return [...byAddress.values()];
}

/**
 * Best-effort human label for an address: display name when known, otherwise the
 * local part prettified (e.g. "no-reply@x.com" -> "no-reply").
 */
export function labelForAddress(parsed: ParsedAddress): string {
  if (parsed.displayName) return parsed.displayName;
  const localPart = parsed.address.split("@")[0] ?? parsed.address;
  return localPart;
}

/** Initials for an avatar chip, max two characters. */
export function initialsFor(label: string): string {
  const words = label.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Deterministic avatar hue bucket (0-4) so a contact keeps the same color. */
export function avatarHueIndex(address: string): number {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = (hash * 31 + address.charCodeAt(i)) >>> 0;
  }
  return hash % 5;
}
