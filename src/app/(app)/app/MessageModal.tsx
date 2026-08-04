"use client";

import { useEffect, useRef, useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { restoreImages } from "@/lib/email/sanitize-html";
import { Linkified } from "@/components/ui/Linkified";

/**
 * The original message, as its sender built it.
 *
 * The chat bubble shows a stripped excerpt — quoted history and signatures
 * removed — because that is the product's promise. This is the other half of
 * that promise: the place where the real, laid-out, graphical email lives, so
 * stripping the cruft never means losing it.
 *
 * ## Why an iframe
 *
 * Email HTML is untrusted third-party content, and 65% of it carries a <style>
 * block. Injected into the app's DOM those rules would be global — an email
 * with `body{display:none}` would take the app with it — and the app's own
 * Tailwind would leak in and render the email wrong. A frame is the only way
 * both documents keep their own CSS.
 *
 * ## The sandbox is the security boundary
 *
 * `sandbox` WITHOUT `allow-scripts` means no script in the email can run at
 * all, and WITHOUT `allow-same-origin` the frame gets an opaque origin, so it
 * cannot reach this document or the Supabase session cookies on it. The
 * server-side sanitizer is the first layer; this is the one that holds if the
 * sanitizer is ever wrong.
 *
 *   NEVER add `allow-scripts` and `allow-same-origin` together. Either alone is
 *   survivable; together they void the sandbox entirely and hand a stranger's
 *   markup full access to the signed-in session.
 *
 * `allow-popups` and `allow-popups-to-escape-sandbox` are safe and deliberate:
 * they let `target="_blank"` links work, and only affect the tab that opens.
 *
 * ## Progressive, never empty
 *
 * The plain-text body is already in props, so the modal opens with content
 * immediately and upgrades to the rendered original when it arrives. Every
 * failure path — no HTML, too large, fetch error — simply stays on the text,
 * which is exactly what this modal showed before this feature existed.
 */
export function MessageModal({
  open,
  onClose,
  messageId,
  title,
  subtitle,
  body,
  alwaysLoadImages = false,
}: {
  open: boolean;
  onClose: () => void;
  messageId: string;
  title: string;
  subtitle?: string | null;
  /** Plain-text body — shown while loading, and wherever HTML isn't available. */
  body: string;
  /** The user's saved preference (Settings › Preferences). */
  alwaysLoadImages?: boolean;
}) {
  // Loaded HTML paired with the message it belongs to, so a render can never
  // show one message's markup under another's title.
  const [loaded, setLoaded] = useState<{
    messageId: string;
    html: string | null;
    blockedImageCount: number;
  } | null>(null);
  const [imagesShown, setImagesShown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);

  // Guards against a slow response for a message the user has already closed
  // or moved on from.
  const requestId = useRef(0);

  // Derive during render rather than resetting in an effect — the same pattern
  // AppShell and ThreadPane use, and what keeps a reopened modal from showing
  // the previous message's document for a frame.
  const key = open ? messageId : null;
  if (key !== lastKey) {
    setLastKey(key);
    setLoaded(null);
    // Each open starts from the user's saved preference, so a one-off "Show
    // images" never silently carries over to the next message.
    setImagesShown(alwaysLoadImages);
    setLoading(key !== null);
  }

  useEffect(() => {
    if (!open) return;

    const id = ++requestId.current;
    let active = true;

    void (async () => {
      try {
        const res = await fetch(
          `/api/messages/${messageId}/html${alwaysLoadImages ? "?images=1" : ""}`,
        );
        if (!active || id !== requestId.current) return;
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const json = await res.json();
        if (!active || id !== requestId.current) return;
        setLoaded({
          messageId,
          html: json.html ?? null,
          blockedImageCount: json.blockedImageCount ?? 0,
        });
        setLoading(false);
      } catch {
        // Silent: the plain-text body is already on screen and remains correct.
        if (active && id === requestId.current) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [open, messageId, alwaysLoadImages]);

  const html = loaded?.messageId === messageId ? loaded.html : null;
  const blockedImageCount =
    loaded?.messageId === messageId ? loaded.blockedImageCount : 0;

  // Restoring images is a string swap on already-sanitized markup, so it costs
  // no second round trip. Safe because re-attaching a src to an <img> cannot
  // introduce script — see restoreImages().
  const shownHtml =
    html === null ? null : imagesShown ? restoreImages(html) : html;

  const canShowImages = html !== null && !imagesShown && blockedImageCount > 0;

  // Sized for where this is going, not where it currently is: the panel takes
  // its full size while still loading, so the common case (the message has
  // HTML — 98% of them do) doesn't visibly jump from a small text box to a
  // large frame a moment later. It settles back only when the HTML genuinely
  // isn't coming, which is the rare case and reads as a deliberate fallback.
  const renderingHtml = shownHtml !== null || loading;

  return (
    <Modal
      open={open}
      onClose={onClose}
      label={title}
      // Email is conventionally authored at 600px; 860 leaves room for that
      // plus the modal's own padding without the design floating in whitespace.
      maxWidth={renderingHtml ? 860 : 680}
      fill={renderingHtml}
    >
      <ModalHeader title={title} subtitle={subtitle} onClose={onClose} />

      {/* A thin progress line rather than a message in the body: the text is
          already readable underneath, so this says "more is coming" without
          moving anything or implying the content is missing. */}
      {loading && (
        <div className="h-0.5 shrink-0 overflow-hidden bg-black/[0.06]">
          <div className="h-full w-1/3 animate-pulse bg-spruce/40" />
        </div>
      )}

      {canShowImages && (
        <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] bg-cream px-6 py-2.5">
          <p className="text-[12.5px] text-text-muted">
            Images are blocked so the sender can&rsquo;t tell you opened this.
          </p>
          <button
            type="button"
            onClick={() => setImagesShown(true)}
            className="shrink-0 rounded-full bg-spruce px-3 py-1.5 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90"
          >
            Show images ({blockedImageCount})
          </button>
        </div>
      )}

      {shownHtml === null ? (
        // `min-h-0 flex-1` so this scrolls within the panel rather than
        // overflowing it while the panel is in fill mode (i.e. still loading).
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <p className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.6] text-text-body">
            <Linkified text={body} />
          </p>
        </div>
      ) : (
        <iframe
          // Keyed so switching image state remounts rather than leaving the
          // previous document in place.
          key={imagesShown ? "images" : "blocked"}
          srcDoc={shownHtml}
          title={`Original message: ${title}`}
          // See the doc comment above. Do NOT add allow-scripts or
          // allow-same-origin.
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      )}
    </Modal>
  );
}
