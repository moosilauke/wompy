"use client";

import { useState } from "react";
import { MessageModal } from "./MessageModal";
import { MessageMenu } from "./MessageMenu";

/**
 * Message text, its expand affordance, and the right-click menu.
 *
 * These live together because they share one piece of state: whether the full
 * message is open. Both the inline link and the menu's "View full message" need
 * to drive it, so the modal is owned here rather than in either one.
 *
 * Excerpting happens on the server (see lib/email/excerpt.ts); this renders the
 * result. The inline label names what was cut, so "Show more" never reads as
 * arbitrary — quoted history and a signature are different from a long message.
 */
export function MessageBody({
  messageId,
  excerpt,
  full,
  truncated,
  removed,
  outgoing = false,
  title,
  subtitle,
  children,
}: {
  messageId: string;
  excerpt: string;
  full: string;
  truncated: boolean;
  removed: { quotedHistory: boolean; signature: boolean; lengthCapped: boolean };
  outgoing?: boolean;
  title: string;
  subtitle?: string | null;
  /** Extra content rendered inside the bubble, below the text. */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const label = (() => {
    if (removed.quotedHistory && removed.signature)
      return "Show signature and quoted replies";
    if (removed.quotedHistory) return "Show quoted replies";
    if (removed.signature) return "Show signature";
    return "Show full message";
  })();

  return (
    <>
      <MessageMenu
        messageId={messageId}
        onShowFull={truncated ? () => setOpen(true) : undefined}
      >
        <p className="whitespace-pre-wrap break-words">{excerpt}</p>

        {truncated && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`mt-1.5 text-[12.5px] font-bold underline underline-offset-2 transition-opacity hover:opacity-80 ${
              outgoing ? "text-white/70" : "text-coral"
            }`}
          >
            {label}
          </button>
        )}

        {children}
      </MessageMenu>

      <MessageModal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        subtitle={subtitle}
        body={full}
      />
    </>
  );
}
