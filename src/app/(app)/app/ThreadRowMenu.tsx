"use client";

import { ContextMenu, useContextMenu, type MenuAction } from "./ContextMenu";
import { useMessageActions } from "./useMessageActions";
import type { ContactTab } from "@/lib/types";

/** Where a conversation can be moved, and what to call it. */
const MOVE_TARGETS: { tab: ContactTab; label: string }[] = [
  { tab: "contact", label: "Move to Contacts" },
  { tab: "company", label: "Move to Companies" },
  { tab: "spam", label: "Move to Spam" },
];

/**
 * Wraps a contact-rail row so right-clicking it offers conversation-level
 * actions. The actions array is where archive, snooze, or reclassify will slot
 * in.
 */
export function ThreadRowMenu({
  threadId,
  label,
  unread,
  currentTab,
  children,
}: {
  threadId: string;
  label: string;
  /** Drives whether the menu offers "mark read" or "mark unread". */
  unread: boolean;
  /** Tab this conversation is in, so it isn't offered as a destination. */
  currentTab: ContactTab;
  children: React.ReactNode;
}) {
  const { position, open, close } = useContextMenu();
  const { trash, setRead, reclassify } = useMessageActions();

  const actions: MenuAction[] = [
    // Non-destructive first; Delete stays last so it is never the default
    // target of a mis-click.
    {
      id: "read-toggle",
      label: unread ? "Mark as read" : "Mark as unread",
      onSelect: () => void setRead({ threadId }, unread),
    },
    // Correcting the classifier. Only the tabs it isn't already in — "Move to
    // Companies" on a conversation already in Companies is noise.
    ...MOVE_TARGETS.filter((t) => t.tab !== currentTab).map((t) => ({
      id: `move-${t.tab}`,
      label: t.label,
      onSelect: () =>
        void reclassify(threadId, t.tab, `Conversation with ${label}`),
    })),
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
