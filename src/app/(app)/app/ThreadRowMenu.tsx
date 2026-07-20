"use client";

import { ContextMenu, useContextMenu, type MenuAction } from "./ContextMenu";
import { useMessageActions } from "./useMessageActions";

/**
 * Wraps a contact-rail row so right-clicking it offers conversation-level
 * actions. Currently just Delete; the actions array is where archive, mark
 * read, snooze, or reclassify will slot in.
 */
export function ThreadRowMenu({
  threadId,
  label,
  children,
}: {
  threadId: string;
  label: string;
  children: React.ReactNode;
}) {
  const { position, open, close } = useContextMenu();
  const { trash } = useMessageActions();

  const actions: MenuAction[] = [
    {
      id: "trash",
      label: "Delete conversation",
      destructive: true,
      onSelect: () => void trash({ threadId }, `Conversation with ${label}`),
    },
  ];

  return (
    <div onContextMenu={open}>
      {children}
      <ContextMenu position={position} actions={actions} onClose={close} />
    </div>
  );
}
