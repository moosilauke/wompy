/**
 * Reducing an email body to the part a person actually wrote.
 *
 * The product shows conversations as chat bubbles, so a bubble should carry the
 * message and nothing else. Real mail buries that: a representative example from
 * the test corpus stored 4,381 characters, of which the actual message was 108.
 * The other 97.5% was a signature block and five levels of quoted history.
 *
 * Truncating at a fixed character count is not enough on its own — 365
 * characters of that message would still be signature and quote chain. So the
 * body is structurally trimmed first, then length-capped only if what remains is
 * still long.
 *
 * Pure and dependency-free so it can be tested directly against real bodies.
 *
 * Deliberately conservative: when a boundary is ambiguous, keep the text. Under-
 * trimming shows a little clutter; over-trimming hides what someone said, which
 * is much worse. Nothing here is destructive — the full body is always kept in
 * the database and shown in the expanded view.
 */

/** Matches the compose limit, so reading and writing share one constraint. */
export const EXCERPT_LIMIT = 365;

/**
 * "On <date>, <name> wrote:" — the attribution line mail clients insert above
 * quoted text. Everything from here down is history, not new content.
 *
 * Allowed to span two lines because clients wrap it, and the wrapped remainder
 * would otherwise be left stranded at the end of the excerpt.
 */
const QUOTE_ATTRIBUTION =
  /^[ \t]*(On\s[\s\S]{0,300}?\swrote:|El\s[\s\S]{0,300}?\sescribió:|Le\s[\s\S]{0,300}?\sa écrit\s*:|Am\s[\s\S]{0,300}?\sschrieb[\s\S]{0,150}?:)[ \t]*$/m;

/**
 * An attribution line that got wrapped and lost its "wrote:" — e.g. the address
 * spilled onto the next line. Matched as a fallback so the opener isn't left
 * dangling at the end of an excerpt.
 */
const QUOTE_ATTRIBUTION_PARTIAL =
  /^[ \t]*On\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+.{0,120}$/m;

/** Outlook-style header block introducing quoted mail. */
const FORWARD_HEADER =
  /^\s*(-{2,}\s*(Original Message|Forwarded message)\s*-{2,}|_{5,}|From:\s.+)$/im;

/**
 * The line mail clients insert right above a forwarded message's header block —
 * "Begin forwarded message:" (Apple Mail) or similar. Matched separately from
 * FORWARD_HEADER because it sits *above* the From:/Date:/To:/Subject: block
 * that FORWARD_HEADER cuts at, and a bare forward has nothing else.
 */
const FORWARD_OPENER = /^\s*(-{0,2}\s*begin forwarded message\s*:?\s*-{0,2})\s*$/im;

/**
 * The From:/Date:/To:/Subject: (/Reply-To:) header block a mail client inserts
 * above forwarded content, so it can be stripped from the forwarded body itself
 * rather than mistaken for prose.
 */
const FORWARDED_HEADER_BLOCK =
  /^\s*From:\s.*\n(?:\s*(?:Date|To|Cc|Subject|Reply-To):.*\n?)*/im;

/**
 * RFC 3676 signature delimiter: a line of exactly "--" (optionally with a
 * trailing space). Unambiguous when present.
 */
const SIG_DELIMITER = /^\s*--\s*$/;

/**
 * Lines that look like signature content rather than prose: a phone number, a
 * bare URL or email, a social handle, or a legal disclaimer opener.
 */
const SIG_LINE_PATTERNS: RegExp[] = [
  /^\s*[*_]*\(?\+?\d[\d\s().-]{7,}[*_]*\s*$/, // phone numbers
  /^\s*[*_]*(https?:\/\/|www\.)\S+[*_]*\s*$/i, // bare URL
  /^\s*[*_]*[\w.+-]+@[\w.-]+\.\w{2,}[*_]*\s*$/i, // bare email address
  /^\s*[*_]*(tel|phone|mobile|cell|fax|office|direct)[:.]?\s*\+?[\d\s().-]{7,}/i,
  /^\s*[*_]*(sent from my|get outlook for|this e?-?mail (and any attachments? )?(is|are) confidential)/i,
  /^\s*[*_]*(linkedin|twitter|x\.com|facebook|instagram)[:.]?\s*\S*\s*$/i,
  /^\s*[*_]*click here\b/i,
];

/**
 * Job-title / company-line shape: short, title-cased or emphasised, no sentence
 * punctuation. Only meaningful adjacent to other signature lines, never alone —
 * it would otherwise match ordinary short sentences.
 */
const SIG_TITLE_LINE = /^\s*[*_]*[A-Z][^.!?]{2,60}[*_]*\s*$/;

export interface Excerpt {
  /** The text to show in a bubble. */
  text: string;
  /** True when content was removed and an expand affordance is needed. */
  truncated: boolean;
  /**
   * The complete original body, tidied but not trimmed.
   *
   * The expanded view must show what was actually removed: an earlier version
   * returned the structurally-cleaned body here, so "Show signature and quoted
   * replies" opened a modal containing neither.
   */
  full: string;
  /**
   * Quotes and signature removed, but no length cap — the whole of what this
   * person actually wrote. What search should index: the excerpt would cut off
   * long messages, and `full` would match text quoted from someone else.
   */
  cleaned: string;
  /** What was trimmed, for explaining the cut in the UI. */
  removed: {
    quotedHistory: boolean;
    signature: boolean;
    lengthCapped: boolean;
  };
}

/**
 * Strip quoted history: everything from an attribution line or forward header
 * onward, plus any trailing block of `>`-prefixed lines.
 */
function stripQuotedHistory(body: string): { text: string; removed: boolean } {
  let cut = body.length;

  for (const pattern of [
    QUOTE_ATTRIBUTION,
    FORWARD_HEADER,
    FORWARD_OPENER,
    QUOTE_ATTRIBUTION_PARTIAL,
  ]) {
    const match = pattern.exec(body);
    if (match && match.index < cut) cut = match.index;
  }

  let text = body.slice(0, cut);
  const removed = cut < body.length;

  // Drop a trailing run of quoted lines even without an attribution line (some
  // clients omit it). Only from the end, so a quote the sender wrote *above*
  // their reply is preserved.
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1].trim();
    if (line === "" || line.startsWith(">")) end -= 1;
    else break;
  }
  const trimmedQuoteRun = end < lines.length;
  if (trimmedQuoteRun) text = lines.slice(0, end).join("\n");

  return { text, removed: removed || trimmedQuoteRun };
}

/**
 * Strip a trailing signature block.
 *
 * Two cases. An explicit `--` delimiter is unambiguous, so everything after it
 * goes. Otherwise, walk up from the bottom while lines look like signature
 * content, and only cut if the run holds at least two such lines — a single
 * trailing line is too easily a real closing sentence.
 */
function stripSignature(body: string): { text: string; removed: boolean } {
  const lines = body.split("\n");

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (SIG_DELIMITER.test(lines[i])) {
      return { text: lines.slice(0, i).join("\n"), removed: true };
    }
  }

  let cut = lines.length;
  let strongHits = 0;
  // Counted in non-blank lines: signature blocks are often double-spaced, so a
  // raw line budget would run out before reaching the top of the block.
  let contentScanned = 0;
  // Non-signature lines tolerated before giving up. Signature blocks contain
  // wrapped continuations ("...to\nfind a location near you.") that match
  // nothing on their own; stopping at the first such line would miss the block
  // entirely. Bounded so prose is never scanned far.
  let misses = 0;

  for (let i = lines.length - 1; i >= 0 && contentScanned < 16; i -= 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      continue; // blank lines are common inside signature blocks
    }
    contentScanned += 1;

    if (SIG_LINE_PATTERNS.some((p) => p.test(line))) {
      strongHits += 1;
      cut = i;
      misses = 0;
      continue;
    }

    // A title/company line only counts once a strong signal has been seen
    // below it, so ordinary short sentences aren't mistaken for a signature.
    if (strongHits > 0 && SIG_TITLE_LINE.test(line) && trimmed.length <= 60) {
      cut = i;
      misses = 0;
      continue;
    }

    // A person's name in emphasis (*Sarah Beddow*) is how many clients mark the
    // start of a signature block. Only honoured with strong signals below it.
    if (strongHits > 0 && /^\s*[*_][^*_]{2,40}[*_]\s*$/.test(line)) {
      cut = i;
      misses = 0;
      continue;
    }

    // Allow a couple of unrecognised lines (wrapped continuations) before
    // concluding we've reached prose. `cut` stays at the last real signal, so
    // these are only crossed, never included in the cut.
    misses += 1;
    if (misses > 2) break;
  }

  // Require two independent signals, so one trailing URL or phone number
  // doesn't swallow a real closing line.
  if (strongHits >= 2 && cut < lines.length) {
    return { text: lines.slice(0, cut).join("\n"), removed: true };
  }

  return { text: body, removed: false };
}

/** Collapse 3+ blank lines and trim trailing whitespace per line. */
function tidy(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cut at a word boundary near the limit rather than mid-word. */
function capLength(text: string, limit: number): { text: string; capped: boolean } {
  if (text.length <= limit) return { text, capped: false };

  const slice = text.slice(0, limit);
  // Prefer a sentence end, then a space, but don't backtrack so far that the
  // excerpt becomes uselessly short.
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("\n"),
  );
  const cut =
    sentenceEnd > limit * 0.6
      ? sentenceEnd + 1
      : slice.lastIndexOf(" ") > limit * 0.6
        ? slice.lastIndexOf(" ")
        : limit;

  return { text: slice.slice(0, cut).replace(/\s+$/, ""), capped: true };
}

/**
 * Recover the forwarded content of a bare forward: no comment of the sender's
 * own, just a forward opener/header and someone else's message. Returns the
 * forwarded body with ITS header block (From:/Date:/To:/Subject:) and any
 * quote markers stripped, or null if the body doesn't look like a bare forward
 * at all (so the caller falls back to showing the untrimmed original).
 *
 * Deliberately narrow: only engages when stripQuotedHistory left nothing,
 * meaning the sender added no text of their own. A forward WITH a comment
 * ("thought you'd like this — " + forwarded mail) already keeps that comment
 * as `trimmed`, so this never overrides real content.
 */
function recoverForwardedContent(source: string): string | null {
  const opener = FORWARD_OPENER.exec(source) ?? FORWARD_HEADER.exec(source);
  if (!opener) return null;

  let body = source.slice(opener.index + opener[0].length);
  // Quote markers (blockquote-derived `>` prefixes) sometimes wrap the entire
  // forwarded block; strip them so the recovered text doesn't read as a quote.
  body = body
    .split("\n")
    .map((line) => line.replace(/^\s*>+\s?/, ""))
    .join("\n");

  // The forwarded message's own From:/Date:/To:/Subject: block is the mail
  // client's bookkeeping, not prose — drop it the same way FORWARD_HEADER
  // would if it re-appeared inside a nested forward.
  body = body.replace(FORWARDED_HEADER_BLOCK, "");

  const tidied = tidy(body);
  return tidied.length > 0 ? tidied : null;
}

/**
 * Reduce a raw body to what should appear in a bubble.
 *
 * Order matters: quoted history is removed before the signature, because a
 * signature sits above the quote chain and would otherwise be unreachable from
 * the bottom.
 */
export function buildExcerpt(
  body: string | null | undefined,
  limit: number = EXCERPT_LIMIT,
): Excerpt {
  const source = (body ?? "").replace(/\r\n?/g, "\n");
  if (!source.trim()) {
    return {
      text: "",
      truncated: false,
      full: "",
      cleaned: "",
      removed: { quotedHistory: false, signature: false, lengthCapped: false },
    };
  }

  const dequoted = stripQuotedHistory(source);
  const designed = stripSignature(dequoted.text);
  const trimmed = tidy(designed.text);

  // If trimming left nothing, either the message was only a signature/quote
  // chain on top of a real reply (fall back to the untrimmed original — under-
  // trimming beats hiding what someone wrote), or it's a *bare forward*: no
  // comment of the sender's own, just "Begin forwarded message:" and someone
  // else's content. There the forwarded content is the whole point of the
  // email, so recover and excerpt THAT rather than showing a near-empty bubble
  // or the sender's throwaway header lines.
  const forwarded = trimmed.length === 0 ? recoverForwardedContent(source) : null;
  const meaningful = trimmed.length > 0 ? trimmed : (forwarded ?? tidy(source));
  const usedFallback = trimmed.length === 0 && forwarded === null;

  const { text, capped } = capLength(meaningful, limit);

  // The expanded view gets the whole original, so the expand control's promise
  // is honoured: asking to see a signature or quoted replies actually shows
  // them.
  const full = tidy(source);

  return {
    text,
    truncated:
      capped ||
      (!usedFallback && (dequoted.removed || designed.removed)),
    full,
    cleaned: meaningful,
    removed: {
      quotedHistory: !usedFallback && dequoted.removed,
      signature: !usedFallback && designed.removed,
      lengthCapped: capped,
    },
  };
}
