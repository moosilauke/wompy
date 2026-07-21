"use client";

import { ContextMenu, useContextMenu, type MenuAction } from "./ContextMenu";
import { useMessageActions } from "./useMessageActions";

/**
 * Wraps a single message (a chat bubble or a Companies list card) so
 * right-clicking it offers message-level actions.
 *
 * Same pattern as ThreadRowMenu but scoped to one message, which is how you
 * remove a single bad message from an otherwise good conversation.
 */
export function MessageMenu({
  messageId,
  onShowFull,
  children,
}: {
  messageId: string;
  /** Provided when the message was trimmed, so "View full message" applies. */
  onShowFull?: () => void;
  children: React.ReactNode;
}) {
  const { position, open, close } = useContextMenu();
  const { trash } = useMessageActions();

  const actions: MenuAction[] = [
    // Non-destructive actions first; Delete stays last so it is never the
    // default target of a mis-click.
    ...(onShowFull
      ? [
          {
            id: "show-full",
            label: "View full message",
            onSelect: onShowFull,
          },
        ]
      : []),
    {
      id: "trash",
      label: "Delete message",
      destructive: true,
      onSelect: () => void trash({ messageIds: [messageId] }, "Message"),
    },
  ];

  return (
    <div onContextMenu={open}>
      {children}
      <ContextMenu position={position} actions={actions} onClose={close} />
    </div>
  );
}
