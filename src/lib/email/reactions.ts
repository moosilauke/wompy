/**
 * Emoji reactions over email.
 *
 * There is no side channel: a reaction IS an email. It carries `In-Reply-To`
 * pointing at the message being reacted to, plus a specially-typed MIME part
 * that supporting clients render as a badge instead of a message. Clients that
 * don't understand the part fall back to the plain-text body and show it as a
 * (very short) reply.
 *
 * Two formats are emitted, because there are two:
 *   - Gmail's `text/vnd.google.email-reaction+json`
 *     https://developers.google.com/workspace/gmail/reactions/format
 *   - RFC 9078's `Content-Disposition: reaction`
 *     https://www.rfc-editor.org/rfc/rfc9078.txt
 *
 * Gmail renders the first, standards-following clients the second, and a client
 * that understands neither shows the emoji as text — which at least reads as
 * intentional rather than as a malformed message.
 *
 * Pure and dependency-free so the MIME output can be inspected directly.
 */

/**
 * Domains whose clients render reactions rather than showing them as replies.
 *
 * This is the single place that decides where reactions are offered. Support is
 * NOT advertised anywhere in email — you cannot ask a provider what it
 * understands — so this list is a deliberate, conservative guess based on which
 * webmail clients implement the feature.
 *
 * The guess is imperfect by nature: someone with a gmail.com address might read
 * mail in Apple Mail, where the reaction arrives as a short reply. Keeping the
 * list narrow limits how often that happens.
 */
const REACTION_CAPABLE_DOMAINS = new Set([
  // Gmail — implements its own format and renders it in web and mobile.
  "gmail.com",
  "googlemail.com",
  // Outlook / Microsoft consumer domains. Listed in anticipation of Outlook
  // provider support; Microsoft ships reactions in Outlook for Web and New
  // Outlook.
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
]);

/** True when every recipient is somewhere reactions are likely to render. */
export function canReactTo(addresses: string[]): boolean {
  if (addresses.length === 0) return false;
  return addresses.every((address) => {
    const at = address.lastIndexOf("@");
    if (at === -1) return false;
    return REACTION_CAPABLE_DOMAINS.has(address.slice(at + 1).toLowerCase());
  });
}

/**
 * Reject anything that isn't a single emoji.
 *
 * Gmail validates strictly and drops malformed reactions, so a bad value would
 * silently send a plain email instead. Checked before sending rather than
 * discovering it from the recipient's confusion.
 *
 * Uses Unicode property escapes so this follows the emoji standard rather than a
 * hand-maintained range list. Sequences with joiners and skin-tone modifiers
 * (👍🏽, 👨‍👩‍👧) are single emoji to a reader and must be treated as one here.
 */
export function isSingleEmoji(value: string): boolean {
  if (!value) return false;

  // One grapheme cluster: what a person perceives as one character.
  const segmenter = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  });
  const graphemes = [...segmenter.segment(value)];
  if (graphemes.length !== 1) return false;

  // And it must actually be emoji, not an arbitrary character.
  return /\p{Extended_Pictographic}/u.test(value);
}

export interface BuildReactionInput {
  from: string;
  to: string[];
  cc?: string[];
  /** Message-ID of the message being reacted to. Exactly one, per the spec. */
  inReplyTo: string;
  /** Existing References chain, so the reaction threads correctly. */
  references?: string | null;
  /** Subject of the target message; reactions reuse it with `Re:`. */
  subject: string;
  emoji: string;
}

/**
 * Build a reaction as a raw, base64url-encoded RFC 2822 message.
 *
 * Part order is deliberate. Gmail's documentation notes that some clients
 * display the LAST part regardless of whether they understand its MIME type, so
 * the plain-text fallback goes first and the machine-readable parts after —
 * inverting that would show raw JSON to anyone whose client guesses wrong.
 */
export function buildReactionMessage(input: BuildReactionInput): string {
  const boundary = `----=_wompy_reaction_${Date.now().toString(36)}`;

  const headers = [
    `From: ${sanitize(input.from)}`,
    `To: ${input.to.map(sanitize).join(", ")}`,
    ...(input.cc && input.cc.length > 0
      ? [`Cc: ${input.cc.map(sanitize).join(", ")}`]
      : []),
    `Subject: ${encodeHeader(sanitize(input.subject))}`,
    `In-Reply-To: ${sanitize(input.inReplyTo)}`,
    ...(input.references
      ? [`References: ${sanitize(input.references)}`]
      : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const reactionJson = JSON.stringify({ version: 1, emoji: input.emoji });

  const parts = [
    // Fallback. A client that understands neither format shows just the emoji,
    // which reads as a deliberate short message rather than a broken one.
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Body(input.emoji),
    ].join("\r\n"),

    // Gmail's format.
    [
      `--${boundary}`,
      'Content-Type: text/vnd.google.email-reaction+json; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Body(reactionJson),
    ].join("\r\n"),

    // RFC 9078. A text/plain part marked as a reaction by its disposition.
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Disposition: reaction",
      "Content-Transfer-Encoding: base64",
      "",
      base64Body(input.emoji),
    ].join("\r\n"),
  ];

  const message = [
    headers.join("\r\n"),
    "",
    ...parts,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Base64 with the 76-character line wrapping MIME requires. */
function base64Body(text: string): string {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? encoded;
}

/** Strip CR/LF so a value can't inject extra headers. */
function sanitize(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** RFC 2047 encoded-word for headers containing non-ASCII. */
function encodeHeader(value: string): string {
  if (!/[^ -~]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * Find a reaction in a received message's MIME tree.
 *
 * Handles both formats, so a reaction from a standards-following client is
 * recognised as readily as one from Gmail.
 */
export function extractReaction(part: {
  mimeType?: string | null;
  headers?: { name?: string | null; value?: string | null }[] | null;
  body?: { data?: string | null } | null;
  parts?: unknown[] | null;
}): string | null {
  const mime = (part.mimeType ?? "").toLowerCase();
  const disposition = (part.headers ?? [])
    .find((h) => h.name?.toLowerCase() === "content-disposition")
    ?.value?.toLowerCase();

  if (mime.includes("vnd.google.email-reaction+json") && part.body?.data) {
    try {
      const parsed = JSON.parse(
        Buffer.from(part.body.data, "base64url").toString("utf8"),
      );
      if (parsed?.version === 1 && typeof parsed.emoji === "string") {
        return parsed.emoji;
      }
    } catch {
      // Malformed JSON: not a reaction we can render. Fall through so the
      // message is treated as ordinary mail rather than dropped.
    }
  }

  if (disposition?.startsWith("reaction") && part.body?.data) {
    const text = Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .trim();
    if (isSingleEmoji(text)) return text;
  }

  for (const child of (part.parts ?? []) as Parameters<
    typeof extractReaction
  >[0][]) {
    const found = extractReaction(child);
    if (found) return found;
  }

  return null;
}
