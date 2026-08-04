"use client";

import { useState } from "react";
import { MessageModal } from "./MessageModal";
import { MessageMenu } from "./MessageMenu";

/**
 * Message text, its right-click menu, and the original-message modal.
 *
 * Excerpting happens on the server (see lib/email/excerpt.ts); this renders the
 * result. Expanding is offered only through the context menu — an inline link
 * under every trimmed bubble competed with the message itself for attention,
 * which is exactly what the chat view is meant to avoid.
 *
 * "View original" is offered on EVERY message, not just trimmed ones. It used
 * to be gated on `truncated`, which was right when the modal only showed
 * untrimmed text — but it now shows the sender's actual layout, and a short,
 * well-designed receipt is exactly the case that wants it while being exactly
 * the case `truncated` excludes.
 */
export function MessageBody({
  messageId,
  excerpt,
  full,
  title,
  subtitle,
  alwaysLoadImages = false,
  children,
}: {
  messageId: string;
  excerpt: string;
  full: string;
  title: string;
  subtitle?: string | null;
  /** Settings preference, forwarded to the modal. */
  alwaysLoadImages?: boolean;
  /** Extra content rendered inside the bubble, below the text. */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <MessageMenu messageId={messageId} onShowFull={() => setOpen(true)}>
        <p className="whitespace-pre-wrap break-words">{excerpt}</p>
        {children}
      </MessageMenu>

      <MessageModal
        open={open}
        onClose={() => setOpen(false)}
        messageId={messageId}
        title={title}
        subtitle={subtitle}
        body={full}
        alwaysLoadImages={alwaysLoadImages}
      />
    </>
  );
}
