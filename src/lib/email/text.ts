/**
 * Inbound message text normalization.
 *
 * Pure and dependency-free so it can be tested directly and reused wherever
 * provider text is ingested.
 */

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
 * make markup safe for rendering — `body_html` is still never injected.
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
 * 42% of the test corpus arrives as HTML with no text/plain part, and was
 * showing a "preview only" placeholder instead of content. Converting to text
 * rather than sanitizing-and-injecting is the right trade for this product: the
 * chat view renders prose, and it keeps the guarantee that `body_html` is never
 * injected into the DOM — no XSS surface, no tracking pixels, no remote image
 * loads revealing that mail was opened.
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
