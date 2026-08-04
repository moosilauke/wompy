/**
 * Inbound message text normalization.
 *
 * Pure and dependency-free so it can be tested directly and reused wherever
 * provider text is ingested.
 */

/**
 * Delimiters marking a link's label and destination inside converted text.
 *
 * Defined here because this is the module that WRITES them (see htmlToText);
 * lib/email/linkify.ts reads them back. Unicode private-use characters: they
 * carry no meaning, cannot render as anything a sender intended, and will not
 * occur in genuine mail, so a message cannot forge a link by containing them.
 */
export const LINK_OPEN = "";
export const LINK_SEP = "";
export const LINK_CLOSE = "";

/**
 * Named HTML entities worth handling. Deliberately a short list: numeric
 * entities cover the long tail, and these are the ones that actually appear in
 * mail snippets.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  trade: "™",
  copy: "©",
  reg: "®",
  // Accented characters common in names and European-language mail.
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  ntilde: "ñ",
  oslash: "ø",
  aring: "å",
  szlig: "ß",
};

/**
 * Decode HTML entities in provider-supplied plain text.
 *
 * Gmail's `snippet` field is HTML-escaped: an apostrophe arrives as `&#39;`, so
 * "YOU'VE" reads as "YOU&#39;VE". React escapes its output (correctly — that's
 * what prevents XSS), so the raw entity renders literally on screen. The text
 * has to be decoded before it reaches React.
 *
 * This decodes text only. It is NOT an HTML sanitizer and must never be used to
 * make markup safe for rendering. Sanitizing is a separate job with a separate
 * module — see lib/email/sanitize-html.ts, which is the ONLY thing in this
 * codebase permitted to produce markup from a sender's HTML.
 *
 * `&amp;` is resolved last so a double-escaped `&amp;#39;` decodes to `&#39;`
 * rather than collapsing all the way to an apostrophe in one pass.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input || !input.includes("&")) return input;

  return input
    // Numeric: &#39; and &#x27;
    .replace(/&#(\d+);/g, (match, code) => codePointOrSelf(Number(code), match))
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) =>
      codePointOrSelf(parseInt(hex, 16), match),
    )
    // Named, excluding &amp; which is handled after.
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      const decoded = NAMED_ENTITIES[name.toLowerCase()];
      if (decoded === undefined || name.toLowerCase() === "amp") return match;
      return decoded;
    })
    .replace(/&amp;/gi, "&");
}

/** Guard against invalid code points, which would make String.fromCodePoint throw. */
function codePointOrSelf(code: number, original: string): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return original;
  // Lone surrogates are not valid standalone characters.
  if (code >= 0xd800 && code <= 0xdfff) return original;
  try {
    return String.fromCodePoint(code);
  } catch {
    return original;
  }
}

/**
 * Convert an HTML email body to readable plain text.
 *
 * ~28% of the corpus arrives as HTML with no text/plain part, and was showing a
 * "preview only" placeholder instead of content. Converting to text is the
 * right trade for the CHAT VIEW specifically: bubbles render prose, and this
 * keeps a sender's markup out of the app's own DOM entirely — no XSS surface,
 * no tracking pixels, no remote image loads revealing that mail was opened.
 *
 * The sender's real layout isn't lost, it just lives elsewhere: "View original"
 * renders the actual HTML, sanitized and inside a sandboxed frame with images
 * blocked (lib/email/sanitize-html.ts). Stripping the cruft inline and keeping
 * the original one right-click away are two halves of the same promise.
 *
 * Not a general-purpose HTML parser. It targets the structures that carry
 * meaning in email — block boundaries, list items, link text — and discards the
 * rest.
 */
export function htmlToText(html: string): string {
  if (!html) return "";

  let text = html;

  // Remove entire elements whose content is never readable prose. Non-greedy so
  // multiple occurrences are each removed rather than everything between the
  // first opener and last closer.
  text = text.replace(
    /<(script|style|head|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );
  // Comments, including the conditional comments Outlook-targeted mail is full of.
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Table cells commonly stand in for layout columns; treat as separators so
  // words from adjacent cells don't run together.
  text = text.replace(/<\/(td|th)\s*>/gi, " ");
  text = text.replace(/<\/(tr|table)\s*>/gi, "\n");

  // Block-level boundaries become line breaks.
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(
    /<\/(p|div|h[1-6]|li|ul|ol|blockquote|section|article|header|footer)\s*>/gi,
    "\n",
  );
  text = text.replace(/<li\b[^>]*>/gi, "• ");
  text = text.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Anchors: keep the label AND the destination.
  //
  // The tag-strip below would otherwise discard the href and leave bare label
  // text — "Click here" with no way to find out where it went. Both are kept,
  // wrapped in the private-use delimiters below so the boundary between label
  // and surrounding prose is EXPLICIT rather than inferred.
  //
  // An earlier version used the plain-text convention `label <url>`, which
  // reads well but can't be parsed reliably: with no marker for where the
  // label starts, "Please View your order <url>" captures "Please" into the
  // link text. These characters are in a Unicode private-use area, so they
  // cannot occur in real mail; `stripLinkMarkers` removes them wherever text
  // is used for anything other than rendering (search, excerpting, snippets).
  //
  // This keeps htmlToText's contract intact: it returns TEXT, never markup.
  // `linkifyText` turns the markers back into real anchors, as React elements.
  //
  // The label is dropped when it already IS the URL, which is common in
  // marketing mail and would otherwise render as "https://x" twice.
  text = text.replace(
    /<a\b[^>]*\bhref\s*=\s*["']?(https?:\/\/[^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, label: string) => {
      const plainLabel = label
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!plainLabel) return ` ${href} `;
      // Compared loosely: a label is "the same as" its href even when it drops
      // the scheme or a trailing slash, which is how most senders write it.
      const norm = (s: string) =>
        s.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
      if (norm(plainLabel) === norm(href)) return ` ${href} `;
      return `${LINK_OPEN}${plainLabel}${LINK_SEP}${href}${LINK_CLOSE}`;
    },
  );

  // Drop every remaining tag.
  text = text.replace(/<[^>]+>/g, "");

  text = decodeHtmlEntities(text);

  // Preheader spacers are often double-encoded (`&amp;zwnj;`), so one decode
  // pass leaves a literal `&zwnj;` behind. Strip the named zero-width entities
  // directly rather than decoding twice, which would risk turning genuine
  // escaped text into markup.
  text = text.replace(/&(zwnj|zwj|nbsp|shy|lrm|rlm|#8203|#x200b);/gi, " ");

  // Marketing HTML is padded with zero-width and invisible characters used as
  // preheader spacers; they survive tag-stripping and render as visual noise.
  text = text.replace(/[​-‍⁠﻿­͏]/g, "");
  // Non-breaking spaces behave like spaces once out of HTML.
  text = text.replace(/ /g, " ");

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Normalize a snippet for display: decode entities and collapse whitespace.
 * Returns null for input that is empty once normalized.
 */
export function normalizeSnippet(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const decoded = decodeHtmlEntities(raw).replace(/\s+/g, " ").trim();
  return decoded.length > 0 ? decoded : null;
}
