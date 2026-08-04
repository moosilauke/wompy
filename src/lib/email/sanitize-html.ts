import sanitizeHtml from "sanitize-html";

/**
 * Turn a sender's raw `body_html` into markup safe to render in a sandboxed
 * frame, with remote images defused.
 *
 * This is the security core of the "View original" feature. It is deliberately
 * pure — no DB, no network, no `server-only` — so it can be tested directly.
 * See `sanitize-html.test.ts`, which asserts against payload shapes actually
 * present in a real mailbox (script tags, inline event handlers, `javascript:`
 * URLs, mutation-XSS classics).
 *
 * ## Two layers, not one
 *
 * The output of this function is rendered inside
 * `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc=...>`.
 * The sandbox is what makes a sanitizer bypass survivable: with no
 * `allow-scripts`, script cannot execute at all, and with no
 * `allow-same-origin` the frame has an opaque origin and cannot reach the
 * parent document or its session cookies.
 *
 * That means this function's job is FIDELITY and PRIVACY first, with security
 * as the second line rather than the only one. It should still be treated as
 * security-critical: defence in depth only works if both layers are maintained
 * as though they were the sole one.
 *
 * ## Images are blocked here, not in CSP
 *
 * Remote `src` values are rewritten to `data-wompy-src` so the URL is not in
 * the document at all. A CSP can be bypassed by a parser quirk or a browser
 * bug; an attribute the browser never sees cannot be fetched. The meta CSP in
 * the wrapper document is the belt to this function's braces.
 *
 * Why blanket blocking rather than filtering 1x1 tracking pixels: the sender
 * declares the dimensions. A tracker writes `width="100"` and serves a 1x1.
 * Measured in a real 7,492-message mailbox: 1,551 messages carry a remote
 * image while declaring no 1x1 anywhere, 2,386 size images via CSS, 1,185 hide
 * them with `display:none`, and 669 track via a CSS `background-image` that is
 * not an `<img>` tag at all. Verifying an image's real size requires fetching
 * it, which is precisely the event being avoided. (The ROADMAP also lists
 * "tracking-pixel-vs-photo classification" as a deliberate non-goal.)
 */

/** Attribute the original `src` is parked in while images are blocked. */
export const BLOCKED_SRC_ATTR = "data-wompy-src";

/** Above this, the caller should fall back to plain text rather than render.
 * Sanitizing is fast, but a pathological row shouldn't be able to tie up a
 * request or ship a multi-megabyte `srcdoc`. */
export const MAX_HTML_BYTES = 1_000_000;

export interface SanitizedEmail {
  /** A complete HTML document, ready for `srcdoc`. */
  html: string;
  /**
   * How many blocked images "Show images" would actually bring back — i.e.
   * parked `<img>` srcs only.
   *
   * Deliberately NOT a count of everything defused: remote CSS `url()` values
   * are replaced rather than parked, so they never return. Counting them here
   * would make the button promise more images than it delivers.
   */
  blockedImageCount: number;
}

/**
 * Tags email layout genuinely depends on, beyond sanitize-html's defaults.
 * Email is table-based and still uses presentational markup, so this is wider
 * than a blog-comment allowlist would be.
 */
const EMAIL_TAGS = [
  "img",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "colgroup",
  "col",
  "center",
  "font",
  "span",
  "style",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "sub",
  "sup",
  "small",
  "s",
  "u",
  "big",
];

/**
 * Presentational attributes, allowed on any tag.
 *
 * `style` is here because inline styles are how email layout works — stripping
 * them would gut the feature. It is safe only because scripts cannot run in
 * the sandbox; CSS cannot execute on its own in any browser still supported.
 *
 * Note what is NOT here: anything matching /^on/i. sanitize-html allowlists
 * rather than denylists, so event handlers are dropped structurally rather
 * than by a pattern that could be evaded — but the tests assert it anyway.
 */
const GLOBAL_ATTRS = [
  "style",
  "class",
  "id",
  "align",
  "valign",
  "width",
  "height",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "colspan",
  "rowspan",
  "dir",
  "lang",
  "title",
  "alt",
];

/** Strip CSS constructs that fetch or execute. `@import` and `url()` both
 * reach the network (the latter is how 669 messages in the corpus track
 * without using an `<img>` at all); `expression()` and `behavior:` are legacy
 * IE script vectors that cost nothing to remove. */
function stripDangerousCss(css: string): { css: string; blocked: number } {
  let blocked = 0;

  // FIRST, and most important: `<style>` is a RAW TEXT element, so a browser
  // ends it at the first `</style` regardless of context. Anything after that
  // point is re-parsed as live markup.
  //
  // This is a real bypass, not a hypothetical one — sanitize-html passes
  // `<!-- ... -->` through as style text, so the input
  //     <style><!--</style--><img src=x onerror=alert(1)>
  // came back out verbatim, and a browser would close the style element at
  // `</style--`, then parse the `<img onerror>` as a live element with a live
  // handler. (The sandbox would still stop it executing; this is the layer
  // that stops it existing.)
  //
  // Two defences: drop CSS comments entirely — they carry no meaning in email
  // and are the vehicle here — and neutralise any remaining `</style`.
  let out = css.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/<!--/g, "").replace(/-->/g, "");
  out = out.replace(/<\s*\/\s*style/gi, "\\3C /style");

  out = out.replace(/@import[^;]*;?/gi, "");

  out = out.replace(
    /url\(\s*(['"]?)(https?:|\/\/)[^)]*\1\s*\)/gi,
    () => {
      blocked += 1;
      return "none";
    },
  );

  out = out.replace(/expression\s*\(/gi, "void(");
  out = out.replace(/behavior\s*:/gi, "_behavior:");
  out = out.replace(/-moz-binding\s*:/gi, "_-moz-binding:");

  return { css: out, blocked };
}

/**
 * Sanitize a sender's HTML.
 *
 * `allowRemoteImages` governs images ONLY — it never relaxes anything that
 * affects safety. With it false (the default), remote `src` values move to
 * `data-wompy-src` and remote CSS URLs are neutralised; the client can restore
 * them without a second round-trip when the user asks for images.
 */
export function sanitizeEmailHtml(
  rawHtml: string,
  { allowRemoteImages = false }: { allowRemoteImages?: boolean } = {},
): SanitizedEmail {
  let blockedImageCount = 0;

  const clean = sanitizeHtml(rawHtml, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, ...EMAIL_TAGS],

    // sanitize-html warns (correctly) that allowing <style> is inherently
    // risky, and refuses to stay quiet unless the risk is acknowledged. It is
    // accepted deliberately here: 65% of the corpus carries a <style> block
    // and dropping them would gut the fidelity this feature exists to provide.
    // What makes it survivable is that the output only ever renders inside a
    // sandboxed frame with no `allow-scripts`, so CSS cannot escalate to
    // script execution — plus stripDangerousCss() below removes @import,
    // expression(), behavior: and -moz-binding:, and the wrapper's CSP blocks
    // network fetches. Do not remove <style> support without also revisiting
    // that reasoning; do not keep this flag if the sandbox ever weakens.
    allowVulnerableTags: true,

    // NOTE: attributes written by `transformTags` below must ALSO appear here.
    // sanitize-html applies the allowlist AFTER the transform, so `rel` and
    // BLOCKED_SRC_ATTR would be silently stripped if they were only set in the
    // transform — the image would vanish and links would lose their `rel`.
    allowedAttributes: {
      "*": GLOBAL_ATTRS,
      a: ["href", "name", "target", "rel", ...GLOBAL_ATTRS],
      img: [
        "src",
        "srcset",
        "alt",
        "width",
        "height",
        BLOCKED_SRC_ATTR,
        ...GLOBAL_ATTRS,
      ],
      font: ["color", "face", "size", ...GLOBAL_ATTRS],
      table: ["summary", ...GLOBAL_ATTRS],
      col: ["span", ...GLOBAL_ATTRS],
      colgroup: ["span", ...GLOBAL_ATTRS],
    },

    // `javascript:` is the obvious one (12 real occurrences in the corpus).
    // `data:` is excluded everywhere — a data: URL on an <a> is a navigation
    // vector, and images don't need it while they're blocked anyway.
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,

    // `style` must NOT be in nonTextTags (its default) — we allow the tag, so
    // its text content has to survive to be filtered by transformTags below.
    nonTextTags: ["script", "textarea", "option", "noscript"],

    // Tags whose content is dropped entirely rather than unwrapped. Without
    // this, `<script>alert(1)</script>` would have its tags stripped and leave
    // the literal text "alert(1)" in the rendered body.
    // (`script`/`noscript` are covered by nonTextTags above; these are the
    // structural ones that would otherwise leak their innards as text.)
    disallowedTagsMode: "discard",

    transformTags: {
      // Links open in a new tab — the sandbox blocks in-frame navigation, and
      // `allow-popups-to-escape-sandbox` means the opened tab is a normal one.
      // rel guards against the opener reference and against lending the
      // sender's links our ranking.
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
      }),

      img: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };

        if (!allowRemoteImages) {
          // srcset is dropped rather than parked: it's a comma-separated
          // candidate list, and restoring it correctly isn't worth the
          // complexity when `src` already carries the image.
          delete next.srcset;

          const src = next.src;
          if (src && /^(https?:|\/\/)/i.test(src)) {
            delete next.src;
            next[BLOCKED_SRC_ATTR] = src;
            blockedImageCount += 1;
          } else if (src && /^cid:/i.test(src)) {
            // Inline (cid:) images aren't stored — attachments.ts reads
            // Content-ID only to filter inline parts OUT, and no column keeps
            // it, so there is nothing to resolve against. Dropping the src
            // leaves the alt text, which is the honest result until inline
            // attachments are actually persisted.
            delete next.src;
          }
        }

        return { tagName, attribs: next };
      },

    },
  });

  // Inline `style="..."` attributes and <style> block bodies both need CSS
  // filtering. sanitize-html's `allowedStyles` can allowlist properties but
  // won't rewrite url() values, so this runs as a pass over the output.
  //
  // Operating on the sanitized string is safe: at this point the markup
  // structure is already trusted, and these replacements only ever remove or
  // neutralise, never introduce, tags.
  let out = clean;

  if (!allowRemoteImages) {
    // <style> blocks
    out = out.replace(
      // `(?:<\/style>|$)` so an UNTERMINATED <style> is still filtered.
      // Requiring a closing tag would skip exactly the malformed input most
      // likely to be an attack.
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>|$)/gi,
      (_m, open: string, css: string, close: string) => {
        // Not added to blockedImageCount: these are replaced, not parked, so
        // "Show images" cannot bring them back.
        return `${open}${stripDangerousCss(css).css}${close}`;
      },
    );

    // inline style attributes
    out = out.replace(
      /style="([^"]*)"/gi,
      // Same: neutralised rather than parked, so not counted.
      (_m, css: string) => `style="${stripDangerousCss(css).css}"`,
    );
  } else {
    // Images allowed, but every SAFETY filter still applies — the preference
    // governs images, never security. Same stripDangerousCss() as above (its
    // `url()` rewriting is a no-op cost here); the `</style` break-out defence
    // in particular must not be conditional on the image setting.
    out = out.replace(
      // `(?:<\/style>|$)` so an UNTERMINATED <style> is still filtered.
      // Requiring a closing tag would skip exactly the malformed input most
      // likely to be an attack.
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>|$)/gi,
      (_m, open: string, css: string, close: string) =>
        `${open}${stripDangerousCss(css).css}${close}`,
    );
  }

  return { html: wrapDocument(out, allowRemoteImages), blockedImageCount };
}

/**
 * Wrap sanitized fragments in a complete document for `srcdoc`.
 *
 * The meta CSP is defence in depth behind the sandbox and the src rewriting.
 * `style-src 'unsafe-inline'` is unavoidable — inline styles ARE email layout
 * — and is safe here precisely because no script can run to exploit it.
 *
 * The base stylesheet is deliberately placed BEFORE the email's own styles so
 * the sender can override anything they care about, except the `max-width` on
 * images, which prevents a fixed-width design from blowing out the frame.
 */
function wrapDocument(body: string, allowRemoteImages: boolean): string {
  const imgSrc = allowRemoteImages ? "https: data:" : "data:";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:;">
<style>
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    padding: 16px;
    word-break: break-word;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #2c2a24;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  /* Placeholder for a blocked image, so the layout doesn't collapse and the
     user can see that something is there to load. */
  img:not([src]) {
    min-width: 24px;
    min-height: 24px;
    background: repeating-linear-gradient(
      45deg, #f0ece3, #f0ece3 6px, #e6e0d4 6px, #e6e0d4 12px
    );
    border-radius: 3px;
  }
</style>
</head>
<body>${body}</body>
</html>`;
}

/**
 * Restore blocked images in an ALREADY-SANITIZED document.
 *
 * Runs on the client when the user asks for images, so showing them costs no
 * second round-trip. Safe because the input has been through
 * `sanitizeEmailHtml` — re-attaching a `src` to an `<img>` cannot introduce
 * script, and the attribute name is matched exactly rather than by a loose
 * pattern.
 *
 * CSS `url()` values are NOT restored: they were replaced with `none` rather
 * than parked, since a background image is a minor fidelity loss next to the
 * complexity of round-tripping them.
 */
export function restoreImages(sanitizedHtml: string): string {
  return sanitizedHtml
    .replace(new RegExp(`\\b${BLOCKED_SRC_ATTR}="`, "g"), 'src="')
    .replace(
      /(<meta http-equiv="Content-Security-Policy" content="[^"]*?img-src )data:/,
      "$1https: data:",
    );
}
