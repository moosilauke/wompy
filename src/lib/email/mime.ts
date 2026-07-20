/**
 * RFC 2822 message construction for sending.
 *
 * Pure and dependency-free so it can be tested directly. Getting the three
 * threading headers right is what makes a reply land inside the recipient's
 * existing conversation instead of appearing as an orphaned new message:
 *
 *   - `In-Reply-To`: the Message-ID of the message being replied to
 *   - `References`:  the existing chain, with that Message-ID appended
 *   - (plus `threadId` on the Gmail API request itself — not a header)
 */

export interface BuildMessageInput {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  /** Message-ID of the message being replied to, if this is a reply. */
  inReplyTo?: string | null;
  /** Existing References chain from the message being replied to. */
  references?: string | null;
}

/**
 * Encode a header value that may contain non-ASCII characters.
 *
 * RFC 2047 encoded-word form. Subjects routinely contain emoji and accented
 * characters, which are not legal raw in a header.
 */
export function encodeHeaderValue(value: string): string {
  // Plain ASCII needs no encoding; anything else gets an encoded-word.
  if (!/[^ -~]/.test(value)) return value;
  const base64 = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${base64}?=`;
}

/** Strip CR/LF from a header value to prevent header injection. */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Build the References chain for a reply: the parent's existing chain with the
 * parent's own Message-ID appended. Per RFC 2822, References accumulates the
 * whole ancestry, which is what threads the conversation in other clients.
 */
export function buildReferences(
  parentReferences: string | null | undefined,
  parentMessageId: string | null | undefined,
): string | null {
  const parts: string[] = [];
  if (parentReferences) {
    parts.push(
      ...parentReferences.split(/\s+/).map((s) => s.trim()).filter(Boolean),
    );
  }
  if (parentMessageId) {
    const id = parentMessageId.trim();
    // Avoid duplicating an id already present in the chain.
    if (id && !parts.includes(id)) parts.push(id);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Derive a subject for a net-new message.
 *
 * The chat view deliberately hides subjects — they're letter-writing baggage the
 * product is trying to remove — but recipients' normal mail clients still show
 * one, so an empty subject looks broken. We generate a short one silently from
 * the message text and never surface it in the UI.
 */
export function deriveSubject(body: string): string {
  const firstLine = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  if (!firstLine) return "(no subject)";
  if (firstLine.length <= 60) return firstLine;
  return `${firstLine.slice(0, 57).trimEnd()}…`;
}

/** Prefix a reply subject with "Re: " unless it already has one. */
export function replySubject(parentSubject: string | null | undefined): string {
  const base = (parentSubject ?? "").trim();
  if (!base) return "(no subject)";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

/**
 * Build a complete RFC 2822 message and encode it for the Gmail API, which
 * expects base64url with no padding.
 */
export function buildRawMessage(input: BuildMessageInput): string {
  const headers: string[] = [];

  headers.push(`From: ${sanitizeHeader(input.from)}`);
  headers.push(`To: ${input.to.map(sanitizeHeader).join(", ")}`);
  if (input.cc && input.cc.length > 0) {
    headers.push(`Cc: ${input.cc.map(sanitizeHeader).join(", ")}`);
  }
  headers.push(`Subject: ${encodeHeaderValue(sanitizeHeader(input.subject))}`);

  if (input.inReplyTo) {
    headers.push(`In-Reply-To: ${sanitizeHeader(input.inReplyTo)}`);
  }
  if (input.references) {
    headers.push(`References: ${sanitizeHeader(input.references)}`);
  }

  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: 7bit");

  const message = `${headers.join("\r\n")}\r\n\r\n${input.body}`;

  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
