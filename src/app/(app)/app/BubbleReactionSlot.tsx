"use client";

import { useState } from "react";
import { MessageReactions } from "./MessageReactions";
import { ReactionPicker } from "./ReactionPicker";

/**
 * The reaction layer for one bubble: existing badges, plus the add-reaction
 * control when the conversation supports it.
 *
 * Exists to keep the picker OFF the page until it's wanted. A thread can hold
 * 200 messages, and the picker is a client component with its own state and a
 * useMessageActions() subscription — mounting one per message meant 200 of
 * those for a control that is invisible (opacity-0) until its row is hovered.
 * Hover state has to live in a client component, hence this wrapper around
 * what ReadingPane (a server component) can't own itself.
 *
 * `pickerOpen` keeps the picker mounted once its emoji row is showing, so
 * moving the pointer off the bubble to reach an emoji doesn't unmount the
 * thing being reached for. The picker reports its own open state up rather
 * than the hover alone deciding.
 */
export function BubbleReactionSlot({
  messageId,
  reactions,
  canReact,
  outgoing,
}: {
  messageId: string;
  reactions: React.ComponentProps<typeof MessageReactions>["reactions"];
  canReact: boolean;
  outgoing: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // `contents` so this wrapper adds no box of its own — the children below
      // position themselves against the bubble's existing relative parent.
      className="contents"
    >
      {/* Bottom-left, nudged up and in so it slightly overlaps the bubble — a
          reaction is a response TO the message, and the overlap reads as
          "attached to this one" rather than as a separate element. */}
      {/* Always mounted: a reaction the user adds optimistically may appear on
          a message that had none from the server. The component renders
          nothing when there's nothing to show. */}
      <div className="absolute -bottom-3 left-2.5 z-10">
        <MessageReactions messageId={messageId} reactions={reactions} />
      </div>

      {/* Only when the conversation's recipients can render reactions —
          otherwise sending would produce a plain email. */}
      {canReact && (hovered || pickerOpen) && (
        <ReactionPicker
          messageId={messageId}
          outgoing={outgoing}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
        />
      )}
    </div>
  );
}
