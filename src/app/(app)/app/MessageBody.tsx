"use client";

import { useState } from "react";
import { MessageModal } from "./MessageModal";
import { MessageMenu } from "./MessageMenu";

/**
 * Message text, its right-click menu, and the full-message modal.
 *
 * Excerpting happens on the server (see lib/email/excerpt.ts); this renders the
 * result. Expanding is offered only through the context menu — an inline link
 * under every trimmed bubble competed with the message itself for attention,
 * which is exactly what the chat view is meant to avoid.
 */
export interface RemovedParts {
  quotedHistory: boolean;
  signature: boolean;
  lengthCapped: boolean;
}

/**
 * Name what was trimmed, so the menu item describes the actual content behind
 * it rather than a generic "show more".
 */
export function expandLabel(removed: RemovedParts): string {
  if (removed.quotedHistory && removed.signature)
    return "View signature and quoted replies";
  if (removed.quotedHistory) return "View quoted replies";
  if (removed.signature) return "View signature";
  return "View full message";
}

export function MessageBody({
  messageId,
  excerpt,
  full,
  truncated,
  removed,
  title,
  subtitle,
  children,
}: {
  messageId: string;
  excerpt: string;
  full: string;
  truncated: boolean;
  removed: RemovedParts;
  title: string;
  subtitle?: string | null;
  /** Extra content rendered inside the bubble, below the text. */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <MessageMenu
        messageId={messageId}
        onShowFull={truncated ? () => setOpen(true) : undefined}
        showFullLabel={expandLabel(removed)}
      >
        <p className="whitespace-pre-wrap break-words">{excerpt}</p>
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
