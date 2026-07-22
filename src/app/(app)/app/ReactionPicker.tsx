"use client";

import { useState } from "react";
import { useMessageActions } from "./useMessageActions";

/**
 * The add-reaction control for a message.
 *
 * A small face button that sits just off the bubble; clicking it opens a row of
 * common emoji. Rendered only when the conversation's recipients can actually
 * render reactions — a picker that sends a plain email would be a trap, so the
 * affordance simply isn't there when it wouldn't work. (The server re-checks
 * regardless; the UI is not the enforcement point.)
 */

const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏"];

export function ReactionPicker({
  messageId,
  outgoing = false,
}: {
  messageId: string;
  outgoing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { react } = useMessageActions();

  const choose = (emoji: string) => {
    setOpen(false);
    void react(messageId, emoji);
  };

  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 ${
        // Opposite side from the bubble's tail, so it doesn't crowd the avatar
        // gutter: outgoing bubbles sit on the right, so the control goes left.
        outgoing ? "right-full mr-1" : "left-full ml-1"
      }`}
    >
      {open ? (
        <div className="flex items-center gap-0.5 rounded-full border border-black/[0.08] bg-white px-1.5 py-1 shadow-[0_4px_16px_rgba(0,0,0,0.16)]">
          {QUICK_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => choose(emoji)}
              aria-label={`React with ${emoji}`}
              className="rounded-full px-1 py-0.5 text-[16px] leading-none transition-transform hover:scale-125"
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Add reaction"
          // Hidden until the row is hovered (group-hover on the bubble wrapper),
          // so the chat stays uncluttered.
          className="flex h-7 w-7 items-center justify-center rounded-full border border-black/[0.08] bg-white text-[14px] text-text-muted opacity-0 shadow-[0_2px_8px_rgba(0,0,0,0.12)] transition-opacity group-hover:opacity-100 hover:text-text-body"
        >
          ☺
        </button>
      )}
    </div>
  );
}
