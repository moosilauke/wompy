"use client";

import { useState } from "react";
import { MessageModal } from "./MessageModal";

/**
 * Message text plus its expand affordance.
 *
 * Excerpting happens on the server (see lib/email/excerpt.ts); this renders the
 * result and offers the full text when something was trimmed. The label names
 * what was cut, so "Show more" never feels arbitrary — quoted history and a
 * signature are different from a long message, and the user can tell which.
 */
export function MessageBody({
  excerpt,
  full,
  truncated,
  removed,
  outgoing = false,
  title,
  subtitle,
}: {
  excerpt: string;
  full: string;
  truncated: boolean;
  removed: { quotedHistory: boolean; signature: boolean; lengthCapped: boolean };
  outgoing?: boolean;
  title: string;
  subtitle?: string | null;
}) {
  const [open, setOpen] = useState(false);

  const label = (() => {
    if (removed.lengthCapped) return "Show full message";
    if (removed.quotedHistory && removed.signature)
      return "Show signature and quoted replies";
    if (removed.quotedHistory) return "Show quoted replies";
    if (removed.signature) return "Show signature";
    return "Show full message";
  })();

  return (
    <>
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
