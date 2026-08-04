import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeEmailHtml,
  restoreImages,
  BLOCKED_SRC_ATTR,
} from "./sanitize-html.ts";

/**
 * Tests for the email HTML sanitizer.
 *
 * Every attack case below is a payload shape MEASURED in a real 7,492-message
 * mailbox, not a hypothetical: 174 messages contain `<script>`, 37 contain an
 * inline `onerror=`/`onload=`, 12 contain a `javascript:` URL, 2 contain an
 * `<iframe>`, and 669 track via a CSS `background-image` rather than an
 * `<img>` tag.
 *
 * Run with `npm test`.
 */

const body = (out: string) =>
  out.slice(out.indexOf("<body>") + 6, out.lastIndexOf("</body>"));

// --- Script execution ---------------------------------------------------

test("strips <script> tags and their contents", () => {
  const { html } = sanitizeEmailHtml(
    `<p>hello</p><script>alert(1)</script><p>world</p>`,
  );
  assert.ok(!html.includes("<script"), "script tag survived");
  // The tag being gone isn't enough — its source must not leak as text.
  assert.ok(!html.includes("alert(1)"), "script body leaked as text");
  assert.ok(html.includes("hello") && html.includes("world"));
});

test("strips inline event handlers", () => {
  const { html } = sanitizeEmailHtml(
    `<img src="https://x/a.png" onerror="alert(1)"><div onload="alert(2)">x</div>`,
  );
  assert.ok(!/onerror/i.test(html), "onerror survived");
  assert.ok(!/onload/i.test(html), "onload survived");
});

test("drops javascript: URLs", () => {
  const { html } = sanitizeEmailHtml(
    `<a href="javascript:alert(1)">click</a>`,
  );
  assert.ok(!/javascript:/i.test(html), "javascript: URL survived");
  // The link text should still be there — we neutralise, not delete content.
  assert.ok(html.includes("click"));
});

test("removes iframe, object, embed, form, svg and math", () => {
  const { html } = sanitizeEmailHtml(
    `<iframe src="https://evil"></iframe>` +
      `<object data="x"></object><embed src="x">` +
      `<form action="https://evil"><input name="p"></form>` +
      `<svg><circle /></svg><math><mi>x</mi></math>`,
  );
  for (const tag of [
    "<iframe",
    "<object",
    "<embed",
    "<form",
    "<input",
    "<svg",
    "<math",
  ]) {
    assert.ok(!html.includes(tag), `${tag} survived`);
  }
});

test("removes <base> and <link>, which can retarget or fetch", () => {
  const { html } = sanitizeEmailHtml(
    `<base href="https://evil/"><link rel="stylesheet" href="https://evil/x.css"><p>hi</p>`,
  );
  assert.ok(!/<base/i.test(body(html)), "base survived");
  assert.ok(!/<link/i.test(body(html)), "link survived");
});

// --- Mutation XSS -------------------------------------------------------

/**
 * For mutation-XSS the meaningful assertion is that no LIVE event-handler
 * attribute exists — not that the string "onerror" is absent from the
 * document. These payloads work by breaking out of an attribute or a raw-text
 * element, so the safe outcome is the text being entity-escaped and inert,
 * where the literal characters legitimately remain. Asserting on the escaped
 * text would fail on correct behaviour.
 */
const hasLiveEventHandler = (html: string) => {
  // Only markup the browser would actually parse as an element counts. Two
  // things are inert and must not trip this, or it fails on correct behaviour:
  //   - entity-escaped text inside an attribute (&lt;img ... onerror=...)
  //   - text inside a <style> block, which is CSS, not markup — provided the
  //     block cannot break out, which hasStyleBreakout() asserts separately.
  const withoutStyleBlocks = html.replace(
    /<style\b[^>]*>[\s\S]*?<\/style>/gi,
    "<style></style>",
  );
  const withoutAttrValues = withoutStyleBlocks.replace(/="[^"]*"/g, '=""');
  return /<[^>]+\son[a-z]+\s*=/i.test(withoutAttrValues);
};

/**
 * Does the CSS inside a <style> block contain a premature `</style`?
 *
 * <style> is a raw-text element: a browser ends it at the FIRST `</style`,
 * wherever that appears, and parses everything after as markup. So the unsafe
 * condition is a `</style` sitting inside what was supposed to be CSS — that
 * is the break-out. The legitimate closing tag is not one, which is why this
 * inspects the block's CONTENT rather than splitting the document on the first
 * match (an earlier version did the latter and reported every well-formed
 * document as a breakout).
 */
const hasStyleBreakout = (html: string): boolean => {
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (/<\s*\/\s*style/i.test(m[1])) return true;
  }
  return false;
};

test("survives the <svg><style> mutation-XSS classic", () => {
  const { html } = sanitizeEmailHtml(
    `<svg><style><a title="</style><img src=x onerror=alert(1)>">`,
  );
  assert.ok(!hasLiveEventHandler(html), "live event handler in output");
  assert.ok(!html.includes("<svg"), "svg survived");
  // The payload must be escaped rather than parsed back into a tag.
  assert.ok(!/<img[^>]*onerror/i.test(html), "payload re-parsed into a tag");
});

test("survives the <noscript> mutation-XSS classic", () => {
  const { html } = sanitizeEmailHtml(
    `<noscript><p title="</noscript><img src=x onerror=alert(1)>">`,
  );
  assert.ok(!hasLiveEventHandler(html), "live event handler in output");
  assert.ok(!/<img[^>]*onerror/i.test(html), "payload re-parsed into a tag");
});

// --- Remote images / tracking ------------------------------------------

test("parks remote image src and counts it", () => {
  const { html, blockedImageCount } = sanitizeEmailHtml(
    `<img src="https://tracker.example/open.gif?u=abc123" width="1" height="1">`,
  );
  assert.equal(blockedImageCount, 1);
  assert.ok(!/\ssrc="https/i.test(html), "remote src still live");
  assert.ok(html.includes(BLOCKED_SRC_ATTR), "src was not parked");
  assert.ok(html.includes("u=abc123"), "parked URL should be preserved");
});

test("blocks protocol-relative image srcs too", () => {
  const { html, blockedImageCount } = sanitizeEmailHtml(
    `<img src="//tracker.example/open.gif">`,
  );
  assert.equal(blockedImageCount, 1);
  assert.ok(!/\ssrc="\/\//.test(html), "protocol-relative src still live");
});

test("neutralises remote CSS background images in <style> blocks", () => {
  // 669 real messages track this way — an <img>-only filter never sees them.
  const { html, blockedImageCount } = sanitizeEmailHtml(
    `<style>.a{background-image:url(https://tracker.example/px.gif)}</style><p>x</p>`,
  );
  assert.ok(
    !html.includes("tracker.example"),
    "remote CSS url survived in style block",
  );
  // Deliberately NOT counted: CSS urls are replaced rather than parked, so
  // "Show images" can't bring them back. Counting them would make the button
  // promise more images than it delivers.
  assert.equal(blockedImageCount, 0);
});

test("blockedImageCount counts only what Show images can restore", () => {
  const { html, blockedImageCount } = sanitizeEmailHtml(
    `<img src="https://cdn.example/a.png">` +
      `<img src="https://cdn.example/b.png">` +
      `<style>.x{background:url(https://tracker.example/px.gif)}</style>`,
  );
  assert.equal(blockedImageCount, 2, "count should match restorable images");
  const restored = restoreImages(html);
  const live = (restored.match(/<img[^>]*\bsrc="https?:/gi) || []).length;
  assert.equal(live, blockedImageCount, "count did not match what came back");
});

test("neutralises remote CSS urls in inline style attributes", () => {
  const { html } = sanitizeEmailHtml(
    `<div style="background:url('https://tracker.example/px.gif')">x</div>`,
  );
  assert.ok(
    !html.includes("tracker.example"),
    "remote CSS url survived in style attribute",
  );
});

test("a CSS comment cannot break out of <style> into live markup", () => {
  // REGRESSION: this bypassed the sanitizer. sanitize-html passes HTML
  // comments through as style text, so `<style><!--</style--><img ...>` came
  // back verbatim — and because <style> is a raw-text element, a browser ends
  // it at the first `</style`, re-parsing the rest as a live <img onerror>.
  const { html } = sanitizeEmailHtml(
    `<style><!--</style--><img src=x onerror=alert(1)>`,
  );
  assert.ok(
    !hasStyleBreakout(html),
    "payload escaped <style> and would re-parse as live markup",
  );
  assert.ok(!hasLiveEventHandler(html), "live event handler in output");
});

test("the <style> break-out defence applies with images allowed too", () => {
  // The image preference must never relax a safety filter.
  const { html } = sanitizeEmailHtml(
    `<style><!--</style--><img src=x onerror=alert(1)>`,
    { allowRemoteImages: true },
  );
  assert.ok(
    !hasStyleBreakout(html),
    "payload escaped <style> when images were allowed",
  );
});

test("strips @import, expression() and behavior:", () => {
  const { html } = sanitizeEmailHtml(
    `<style>@import url(https://evil/x.css); .a{width:expression(alert(1));behavior:url(#x)}</style>`,
  );
  assert.ok(!/@import/i.test(html), "@import survived");
  assert.ok(!/expression\s*\(/i.test(html), "expression() survived");
  assert.ok(!/[^_]behavior\s*:/i.test(html), "behavior: survived");
});

test("cid: images are dropped, alt text survives", () => {
  const { html } = sanitizeEmailHtml(
    `<img src="cid:logo@example" alt="Company logo">`,
  );
  assert.ok(!/cid:/i.test(html), "cid: src survived");
  assert.ok(html.includes("Company logo"), "alt text was lost");
});

test("allowRemoteImages leaves images intact", () => {
  const { html, blockedImageCount } = sanitizeEmailHtml(
    `<img src="https://cdn.example/hero.png">`,
    { allowRemoteImages: true },
  );
  assert.equal(blockedImageCount, 0);
  assert.ok(html.includes(`src="https://cdn.example/hero.png"`));
  // ...but scripts are still gone. The preference governs images only.
  const withScript = sanitizeEmailHtml(`<script>alert(1)</script><p>x</p>`, {
    allowRemoteImages: true,
  });
  assert.ok(!withScript.html.includes("alert(1)"));
});

// --- Fidelity -----------------------------------------------------------

test("preserves table layout, presentational attributes and inline styles", () => {
  const { html } = sanitizeEmailHtml(
    `<table cellpadding="8" cellspacing="0" bgcolor="#ffffff" width="600">` +
      `<tr><td align="center" style="color:#333;font-size:14px">Receipt</td></tr>` +
      `</table>`,
  );
  const b = body(html);
  assert.ok(b.includes("<table"), "table lost");
  assert.ok(b.includes(`cellpadding="8"`), "cellpadding lost");
  assert.ok(b.includes(`bgcolor="#ffffff"`), "bgcolor lost");
  assert.ok(b.includes(`align="center"`), "align lost");
  assert.ok(b.includes("color:#333"), "inline style lost");
  assert.ok(b.includes("Receipt"));
});

test("keeps safe links and forces safe rel/target", () => {
  const { html } = sanitizeEmailHtml(
    `<a href="https://example.com/order">View order</a>`,
  );
  assert.ok(html.includes(`href="https://example.com/order"`), "href lost");
  assert.ok(html.includes(`target="_blank"`), "target not set");
  assert.ok(html.includes("noopener"), "noopener missing");
  assert.ok(html.includes("noreferrer"), "noreferrer missing");
});

// --- Document wrapper ---------------------------------------------------

test("wraps output in a document carrying a restrictive CSP", () => {
  const { html } = sanitizeEmailHtml(`<p>hi</p>`);
  assert.ok(html.startsWith("<!doctype html>"), "not a full document");
  assert.ok(html.includes("default-src 'none'"), "CSP missing");
  assert.ok(html.includes("img-src data:"), "img-src should be locked down");
});

test("restoreImages re-enables images without touching anything else", () => {
  const { html } = sanitizeEmailHtml(
    `<img src="https://cdn.example/hero.png"><script>alert(1)</script>`,
  );
  const restored = restoreImages(html);

  assert.ok(
    restored.includes(`src="https://cdn.example/hero.png"`),
    "image was not restored",
  );
  assert.ok(!restored.includes(BLOCKED_SRC_ATTR), "parked attribute remains");
  assert.ok(restored.includes("img-src https: data:"), "CSP not relaxed");
  // The dangerous content stayed gone through the round trip.
  assert.ok(!restored.includes("alert(1)"), "script reappeared after restore");
});

// --- Degenerate input ---------------------------------------------------

test("handles empty and malformed input without throwing", () => {
  assert.equal(sanitizeEmailHtml("").blockedImageCount, 0);
  assert.doesNotThrow(() => sanitizeEmailHtml("<<<>>>"));
  assert.doesNotThrow(() => sanitizeEmailHtml("<div><p>unclosed"));
  assert.doesNotThrow(() => sanitizeEmailHtml("plain text, no markup at all"));
});
