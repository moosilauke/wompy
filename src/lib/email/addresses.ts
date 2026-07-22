import { FREE_MAIL_DOMAINS } from "@/lib/email/classifier";

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
  return fallbackLabel(parsed.address);
}

/**
 * Local parts that name a mailbox's function rather than its owner. Seeing one
 * means the address tells us nothing about who is writing.
 */
const GENERIC_LOCAL_PARTS =
  /^(no-?reply|do-?not-?reply|donotreply|noreply|info|support|hello|hi|team|news|newsletter|mail|mailer|notifications?|notify|alerts?|updates?|contact|admin|help|service|customercare|care|billing|invoices?|receipts?|orders?|sales|marketing|messages?|post|inbox|feedback|survey|reply|auto-?confirm|automated?)([.\-_+].*)?$/i;

/**
 * A readable name for an address with no display name.
 *
 * Normally the local part is the best available guess — `jeconiahlangston@` is
 * closer to a person's name than `gmail.com` is. But when the local part is
 * purely functional, it identifies nothing: `no-reply@sentinelone.com` rendered
 * as "no-reply" tells the user less than "SentinelOne" would.
 *
 * The domain is only substituted when BOTH hold:
 *   - the local part is generic, AND
 *   - the domain isn't free-mail
 *
 * Both conditions matter. `me@aol.com` has a generic-ish local part but "Aol"
 * would be actively wrong — it's a person, and the domain is their mail
 * provider, not their identity. Only an organization's own domain names the
 * sender.
 *
 * Deliberately conservative: when unsure, the local part is kept. It is at
 * worst uninformative, whereas a wrong company name is misinformation.
 */
export function fallbackLabel(address: string): string {
  const at = address.lastIndexOf("@");
  if (at === -1) return address;

  const local = address.slice(0, at);
  const domain = address.slice(at + 1).toLowerCase();

  if (!GENERIC_LOCAL_PARTS.test(local)) return local;
  if (FREE_MAIL_DOMAINS.has(domain)) return local;

  return organizationNameFromDomain(domain) ?? local;
}

/**
 * Turn a sending domain into a display name: `sentinelone.com` → "SentinelOne".
 *
 * Sending subdomains are stripped so `email.schwab.com` and
 * `mail.notifications.acme.co.uk` resolve to the brand rather than the
 * infrastructure in front of it.
 *
 * Returns null when nothing sensible can be derived, so the caller keeps its
 * existing fallback rather than showing something wrong.
 */
function organizationNameFromDomain(domain: string): string | null {
  const registrable = registrableDomain(domain);
  if (!registrable) return null;
  // The brand label is everything before the suffix's final dot.
  const name = registrable.split(".")[0];
  if (!name || name.length < 2) return null;
  return prettifyDomainLabel(name);
}

/**
 * The registrable domain for a host: `email.schwab.com` → `schwab.com`,
 * `mail.notifications.acme.co.uk` → `acme.co.uk`. Strips sending subdomains so
 * a brand resolves regardless of the ESP infrastructure in front of it.
 *
 * Returns null when nothing sensible remains (bare host, single label).
 */
export function registrableDomain(domain: string): string | null {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return null;

  const lastTwo = labels.slice(-2).join(".");
  // Known multi-part suffix (.co.uk): keep the last three labels; else last two.
  const keep = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  if (labels.length < keep) return null;
  return labels.slice(-keep).join(".");
}

/**
 * Public suffixes with two labels. Not exhaustive — the full Public Suffix List
 * is thousands of entries and a dependency this doesn't warrant. An unlisted
 * suffix yields a slightly-off name, not a crash, and the common cases are here.
 */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "co.jp",
  "co.nz",
  "co.za",
  "com.au",
  "com.br",
  "com.mx",
  "com.sg",
  "co.in",
  "co.kr",
]);

/**
 * `sentinelone` → "SentinelOne", `parts-express` → "Parts Express".
 *
 * Known multi-word brands are cased explicitly; anything else gets its
 * separators turned into spaces and each word capitalized. Guessing at word
 * boundaries inside a run of letters is not reliable enough to attempt.
 */
const BRAND_CASING = new Map([
  ["sentinelone", "SentinelOne"],
  ["github", "GitHub"],
  ["gitlab", "GitLab"],
  ["linkedin", "LinkedIn"],
  ["paypal", "PayPal"],
  ["youtube", "YouTube"],
  ["doordash", "DoorDash"],
  ["airbnb", "Airbnb"],
  ["ebay", "eBay"],
  ["iphone", "iPhone"],
  ["openai", "OpenAI"],
  ["chargepoint", "ChargePoint"],
  ["wordpress", "WordPress"],
  ["dropbox", "Dropbox"],
  ["hubspot", "HubSpot"],
  ["mailchimp", "Mailchimp"],
  ["squarespace", "Squarespace"],
  ["substack", "Substack"],
  ["fedex", "FedEx"],
  ["ups", "UPS"],
  ["usps", "USPS"],
  ["ibm", "IBM"],
  ["aws", "AWS"],
  ["nasa", "NASA"],
]);

function prettifyDomainLabel(label: string): string {
  const known = BRAND_CASING.get(label.toLowerCase());
  if (known) return known;

  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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
