/**
 * Find the links in a message's plain text.
 *
 * Pure and JSX-free so it can be tested directly under `node --test` (Node's
 * type stripping can't parse `.tsx`), and so the parsing rules live next to the
 * rest of the email text handling rather than inside a component.
 * `components/ui/Linkified.tsx` renders the result as React elements.
 *
 * Two shapes are recognised, because email produces both:
 *
 *   1. A MARKED link, which htmlToText emits for every <a> tag: the label and
 *      the href wrapped in private-use delimiters (defined in text.ts).
 *      The label is shown and the URL becomes the destination, so "View your
 *      order" stays readable instead of becoming a wall of tracking URL.
 *   2. A bare `https://…` in the text. 4,372 messages in the test mailbox carry
 *      one in their plain-text part alone, and they were previously just as
 *      unclickable as the stripped anchors.
 */

import { LINK_OPEN, LINK_SEP, LINK_CLOSE } from "./text.ts";
export { LINK_OPEN, LINK_SEP, LINK_CLOSE };

/**
 * Remove link markers, leaving just the label.
 *
 * Used anywhere text is consumed for something OTHER than rendering — search
 * indexing, snippets, length budgets — where the markers are noise that must
 * not reach a user or an index.
 */
export function stripLinkMarkers(text: string): string {
  return text.replace(
    new RegExp(
      `${LINK_OPEN}([^${LINK_SEP}]*)${LINK_SEP}[^${LINK_CLOSE}]*${LINK_CLOSE}`,
      "g",
    ),
    "$1",
  );
}

export interface LinkSegment {
  label: string;
  href: string;
}

/**
 * Trailing characters that are almost never part of the URL a sender meant.
 * Closing brackets are only trimmed when unbalanced, so a genuine
 * `https://en.wikipedia.org/wiki/Foo_(bar)` survives intact.
 */
function trimTrailingPunctuation(url: string): string {
  let out = url;
  for (;;) {
    const last = out[out.length - 1];
    if (!last) break;

    if (".,;:!?'\"".includes(last)) {
      out = out.slice(0, -1);
      continue;
    }

    if (last === ")" || last === "]" || last === "}") {
      const open = last === ")" ? "(" : last === "]" ? "[" : "{";
      const opens = out.split(open).length - 1;
      const closes = out.split(last).length - 1;
      if (closes > opens) {
        out = out.slice(0, -1);
        continue;
      }
    }

    break;
  }
  return out;
}

/**
 * Only http(s) is ever linked.
 *
 * The pattern below only matches an explicit http/https scheme, so
 * `javascript:` and `data:` can't reach here — but this asserts it rather than
 * assuming, because it is the one check standing between a sender's string and
 * a live href.
 */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Marked links first, then bare urls — one pass, document order.
 *
 * The marked form comes from htmlToText, which wraps `label` and `href` in
 * private-use delimiters. An earlier version tried to infer the label from a
 * plain-text `label <url>` convention, which cannot be parsed reliably: with no
 * marker for where the label begins, "Please View your order <url>" captured
 * "Please" into the link text. Explicit delimiters remove the guesswork, and
 * because they're private-use characters a sender cannot forge them.
 */
const LINK_PATTERN = new RegExp(
  `${LINK_OPEN}([^${LINK_SEP}]*)${LINK_SEP}([^${LINK_CLOSE}]*)${LINK_CLOSE}` +
    `|(https?:\\/\\/[^\\s<>${LINK_OPEN}${LINK_CLOSE}]+)`,
  "g",
);

/** Split text into plain strings and link segments. */
export function linkifyText(input: string): (string | LinkSegment)[] {
  if (!input) return [];

  // The excerpt length cap operates on marked text and can slice through a
  // marker, leaving an unterminated one at the end. Repaired up front rather
  // than after matching: a partial `…<SEP>https://exa` would otherwise be
  // picked up by the bare-URL branch and linked to a truncated address.
  // (Doing it here also keeps excerpt.ts dependency-free — it has no need to
  // know about link internals.)
  const text = dropPartialMarker(input);

  const out: (string | LinkSegment)[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const [full, markedLabel, markedHref, bareHref] = match;
    const start = match.index ?? 0;
    const isMarked = markedHref !== undefined;

    // A bare URL may pick up sentence punctuation; a marked one is exact.
    const href = isMarked ? markedHref : trimTrailingPunctuation(bareHref);
    if (!isSafeHttpUrl(href)) {
      // Drop the markers but keep the label, so an unsafe href doesn't leave
      // private-use characters on screen.
      if (isMarked) {
        if (start > lastIndex) out.push(text.slice(lastIndex, start));
        out.push(markedLabel);
        lastIndex = start + full.length;
      }
      continue;
    }

    if (start > lastIndex) out.push(text.slice(lastIndex, start));

    if (isMarked) {
      out.push({ label: markedLabel.trim() || shortenUrl(href), href });
      lastIndex = start + full.length;
    } else {
      out.push({ label: shortenUrl(href), href });
      // Anything trimmed off the URL is real text and must not be swallowed.
      lastIndex = start + href.length;
    }
  }

  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

/** Longest URL shown in full before it's abbreviated for display. */
const MAX_URL_LABEL = 48;

/**
 * A readable stand-in for a URL that has no label of its own.
 *
 * Tracking and click-through URLs routinely run to 200+ characters, and one of
 * them as its own label turns a bubble into a wall of base64. The full address
 * is still the href and still shown on hover — this only changes what is
 * printed.
 *
 * The host is always kept, because it is the part that tells someone where a
 * link actually goes, and the tail is kept where it fits so two links to the
 * same host stay distinguishable.
 */
function shortenUrl(href: string): string {
  if (href.length <= MAX_URL_LABEL) return href;

  let host: string;
  let rest: string;
  try {
    const parsed = new URL(href);
    host = parsed.host.replace(/^www\./, "");
    rest = parsed.pathname + parsed.search;
  } catch {
    return href.slice(0, MAX_URL_LABEL - 1) + "…";
  }

  if (rest === "/" || rest === "") return host;

  const room = MAX_URL_LABEL - host.length - 1;
  if (room <= 1) return host;

  // Keep the END of the path: the distinguishing part of a long tracking URL
  // is almost never its first few characters.
  return rest.length <= room ? host + rest : host + "/…" + rest.slice(-(room - 2));
}

/**
 * Repair an unterminated link marker at the end of truncated text.
 *
 * Only the tail can be broken — everything before a cut is intact by
 * construction — so this finds an opener with no matching close, keeps
 * whatever label text made it in, and discards the partial URL.
 */
function dropPartialMarker(text: string): string {
  const open = text.lastIndexOf(LINK_OPEN);
  if (open === -1) return text;
  if (text.indexOf(LINK_CLOSE, open) !== -1) return text; // properly closed

  const tail = text.slice(open + LINK_OPEN.length);
  const label = tail.split(LINK_SEP)[0] ?? "";
  return (text.slice(0, open) + label).replace(/\s+$/, "");
}
