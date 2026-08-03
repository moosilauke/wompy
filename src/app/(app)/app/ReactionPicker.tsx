"use client";

import { useMessageActions } from "./useMessageActions";

/**
 * The add-reaction control for a message.
 *
 * A small face button that sits just off the bubble; clicking it opens a row of
 * common emoji. Rendered only when the conversation's recipients can actually
 * render reactions — a picker that sends a plain email would be a trap, so the
 * affordance simply isn't there when it wouldn't work. (The server re-checks
 * regardless; the UI is not the enforcement point.)
 *
 * Open state is controlled by BubbleReactionSlot, which mounts this only while
 * the bubble is hovered — it needs to know when the emoji row is open so it
 * can keep this mounted while the pointer travels to an emoji.
 */

const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏"];

export function ReactionPicker({
  messageId,
  outgoing = false,
  open,
  onOpenChange,
}: {
  messageId: string;
  outgoing?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { react } = useMessageActions();

  const choose = (emoji: string) => {
    onOpenChange(false);
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
              className="rounded-full p-0.5 text-[18px] leading-none transition-transform hover:scale-125"
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label="Add reaction"
          // Still faded in via group-hover rather than appearing instantly:
          // this only mounts on hover now, but the transition is what keeps it
          // from popping into place under the pointer.
          className="flex h-6 w-6 items-center justify-center rounded-full border border-black/[0.08] bg-white text-[15px] leading-none text-text-muted opacity-0 shadow-[0_2px_8px_rgba(0,0,0,0.12)] transition-opacity group-hover:opacity-100 hover:text-text-body"
        >
          ☺
        </button>
      )}
    </div>
  );
}
