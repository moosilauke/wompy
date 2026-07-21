"use client";

import { ContextMenu, useContextMenu, type MenuAction } from "./ContextMenu";
import { useMessageActions } from "./useMessageActions";

/**
 * Wraps a contact-rail row so right-clicking it offers conversation-level
 * actions. The actions array is where archive, snooze, or reclassify will slot
 * in.
 */
export function ThreadRowMenu({
  threadId,
  label,
  unread,
  children,
}: {
  threadId: string;
  label: string;
  /** Drives whether the menu offers "mark read" or "mark unread". */
  unread: boolean;
  children: React.ReactNode;
}) {
  const { position, open, close } = useContextMenu();
  const { trash, setRead } = useMessageActions();

  const actions: MenuAction[] = [
    // Non-destructive first; Delete stays last so it is never the default
    // target of a mis-click.
    {
      id: "read-toggle",
      label: unread ? "Mark as read" : "Mark as unread",
      onSelect: () => void setRead({ threadId }, unread),
    },
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
