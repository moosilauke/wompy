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
 * Normalize a snippet for display: decode entities and collapse whitespace.
 * Returns null for input that is empty once normalized.
 */
export function normalizeSnippet(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const decoded = decodeHtmlEntities(raw).replace(/\s+/g, " ").trim();
  return decoded.length > 0 ? decoded : null;
}
