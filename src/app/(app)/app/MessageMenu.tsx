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
  children,
}: {
  messageId: string;
  children: React.ReactNode;
}) {
  const { position, open, close } = useContextMenu();
  const { trash } = useMessageActions();

  const actions: MenuAction[] = [
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
