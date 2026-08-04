import { test } from "node:test";
import assert from "node:assert/strict";
import { linkifyText, type LinkSegment } from "./linkify.ts";
import { LINK_OPEN, LINK_SEP, LINK_CLOSE } from "./linkify.ts";

/** Build the marked form htmlToText emits, without hardcoding the delimiters. */
const marked = (label: string, href: string) =>
  `${LINK_OPEN}${label}${LINK_SEP}${href}${LINK_CLOSE}`;

/**
 * Tests for link extraction in message text.
 *
 * This turns untrusted mail content into live hrefs, so the safety cases matter
 * as much as the fidelity ones: a `javascript:` URL reaching an `<a href>`
 * would be an XSS hole even though the text itself is never injected as markup.
 */

const links = (text: string): LinkSegment[] =>
  linkifyText(text).filter((s): s is LinkSegment => typeof s !== "string");

const rendered = (text: string): string =>
  linkifyText(text)
    .map((s) => (typeof s === "string" ? s : s.label))
    .join("");

// --- Safety -------------------------------------------------------------

test("never links a javascript:, data: or file: URL", () => {
  for (const bad of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ]) {
    assert.equal(links(bad).length, 0, `linked a bare ${bad}`);
    assert.equal(
      links(marked("Click here", bad)).length,
      0,
      `linked a marked ${bad}`,
    );
  }
});

test("every produced href is http or https", () => {
  const text =
    `See https://example.com and ${marked("Order", "https://shop.example/x")} and mailto:a@b.c`;
  for (const l of links(text)) {
    assert.ok(/^https?:\/\//.test(l.href), `non-http href: ${l.href}`);
  }
});

// --- Labelled links (what htmlToText emits) -----------------------------

test("keeps the label and uses the URL as the destination", () => {
  const [link] = links(
    `Please ${marked("View your order", "https://shop.example/o/123")} now`,
  );
  assert.equal(link.label, "View your order");
  assert.equal(link.href, "https://shop.example/o/123");
});

test("surrounding text is preserved", () => {
  const out = linkifyText(
    `Before ${marked("View order", "https://x.example/a")} after`,
  );
  assert.equal(out[0], "Before ");
  assert.equal(out[out.length - 1], " after");
});

// --- Bare URLs ----------------------------------------------------------

test("links a bare URL, shown as itself when short", () => {
  const [link] = links("Track it at https://track.example/abc please");
  assert.equal(link.href, "https://track.example/abc");
  assert.equal(link.label, "https://track.example/abc");
});

test("a long bare URL is abbreviated for display but not for navigation", () => {
  // Real tracking URLs run to 200+ characters; printing one in full turns a
  // bubble into a wall of base64.
  const href = `https://click.example.com/ls/${"A1b2C3d4".repeat(20)}/open`;
  const [link] = links(`See ${href} now`);

  assert.equal(link.href, href, "href must stay complete");
  assert.ok(link.label.length <= 48, `label too long: ${link.label.length}`);
  assert.ok(
    link.label.includes("click.example.com"),
    "host should survive — it is what tells you where the link goes",
  );
  assert.ok(link.label.includes("…"), "abbreviation should be visible");
});

test("a bare root URL shows just its host", () => {
  const [link] = links(`Visit https://${"sub.".repeat(12)}example.com/ today`);
  assert.ok(!link.label.includes("/"), `expected host only, got ${link.label}`);
});

test("trailing sentence punctuation is not part of the URL", () => {
  const [link] = links("See https://example.com/page.");
  assert.equal(link.href, "https://example.com/page");
  // ...and the period is still shown to the reader.
  assert.ok(rendered("See https://example.com/page.").endsWith("."));
});

test("balanced parentheses inside a URL survive", () => {
  const [link] = links("https://en.wikipedia.org/wiki/Foo_(bar)");
  assert.equal(link.href, "https://en.wikipedia.org/wiki/Foo_(bar)");
});

test("an unbalanced closing paren is trimmed", () => {
  const [link] = links("(see https://example.com/x)");
  assert.equal(link.href, "https://example.com/x");
});

// --- Fidelity -----------------------------------------------------------

test("text with no links is returned unchanged", () => {
  const text = "Just a normal message with no links at all.";
  assert.deepEqual(linkifyText(text), [text]);
});

test("multiple links are all found, in order", () => {
  const found = links(
    `First ${marked("One", "https://a.example/1")} then https://b.example/2 ` +
      `then ${marked("Three", "https://c.example/3")}`,
  );
  assert.deepEqual(
    found.map((l) => l.href),
    ["https://a.example/1", "https://b.example/2", "https://c.example/3"],
  );
});

test("no text is lost", () => {
  const text = `Go to ${marked("Store", "https://s.example/x")} or https://t.example/y today`;
  assert.equal(rendered(text), "Go to Store or https://t.example/y today");
});

test("a marker sliced by the excerpt cap doesn't show delimiters", () => {
  // buildExcerpt's length cap operates on marked text and can cut mid-marker.
  const cut = `Read the ${LINK_OPEN}Latest news`; // opener + label, no sep/close
  const out = linkifyText(cut);
  const shown = out.map((s) => (typeof s === "string" ? s : s.label)).join("");
  assert.ok(!shown.includes(LINK_OPEN), "stray opener rendered");
  assert.ok(!shown.includes(LINK_SEP), "stray separator rendered");
  assert.ok(shown.includes("Latest news"), "label text was lost");
});

test("a marker cut after the separator drops the partial URL", () => {
  const cut = `Read ${LINK_OPEN}News${LINK_SEP}https://exa`;
  const shown = linkifyText(cut)
    .map((s) => (typeof s === "string" ? s : s.label))
    .join("");
  assert.ok(!shown.includes(LINK_SEP), "stray separator rendered");
  assert.ok(!shown.includes("https://exa"), "partial URL leaked into text");
  assert.ok(shown.includes("News"), "label text was lost");
});

test("handles empty and degenerate input", () => {
  assert.deepEqual(linkifyText(""), []);
  assert.doesNotThrow(() => linkifyText("<<<>>>"));
  assert.doesNotThrow(() => linkifyText("https://"));
  assert.doesNotThrow(() => linkifyText(marked("x", "not-a-url")));
});
