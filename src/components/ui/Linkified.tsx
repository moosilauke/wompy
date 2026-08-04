import React from "react";
import { linkifyText } from "@/lib/email/linkify";

/**
 * Message text with its links clickable.
 *
 * Split into React elements, never injected as HTML. The text is untrusted mail
 * content, so `dangerouslySetInnerHTML` would be an XSS hole — the same
 * reasoning as Search.tsx's `Highlighted`, and the same reason a bubble renders
 * prose rather than a sender's markup. Nothing here produces markup from a
 * string; it produces `<a>` elements whose href was validated first.
 *
 * The parsing lives in lib/email/linkify.ts, which is where its tests are.
 *
 * Links open in a new tab — this is someone else's mail, and navigating the app
 * away from itself would lose the conversation. `noopener`/`noreferrer` keep
 * the destination from reaching back through `window.opener` or learning where
 * the click came from; `nofollow` avoids lending a stranger's link our ranking.
 */
export function Linkified({ text }: { text: string }) {
  const segments = linkifyText(text);

  return (
    <>
      {segments.map((segment, i) =>
        typeof segment === "string" ? (
          <React.Fragment key={`t${i}`}>{segment}</React.Fragment>
        ) : (
          <a
            key={`l${i}`}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            // Keeps a click on the link from also firing the row/menu handlers
            // wrapped around the bubble.
            onClick={(e) => e.stopPropagation()}
            // The full destination on hover, since the label can say anything —
            // "Click here" shouldn't hide where it goes.
            title={segment.href}
            className="underline underline-offset-2 opacity-90 hover:opacity-100"
          >
            {segment.label}
          </a>
        ),
      )}
    </>
  );
}
