"use client";

import { ContextMenu, useContextMenu, type MenuAction } from "./ContextMenu";
import { useMessageActions } from "./useMessageActions";
import type { ContactTab } from "@/lib/types";
import type { RailThread } from "./ContactRail";

/** Where a selection can be moved, and what to call it. */
const MOVE_TARGETS: { tab: ContactTab; label: string }[] = [
  { tab: "contact", label: "Move to Contacts" },
  { tab: "company", label: "Move to Companies" },
  { tab: "spam", label: "Move to Spam" },
];

/**
 * Right-click menu for a multi-selected set of rail rows (ctrl/shift-click).
 *
 * A sibling to ThreadRowMenu rather than a shared component with it: the two
 * operate on genuinely different shapes (one thread vs. several ids), and
 * forcing them into one component would mean a union prop type threaded
 * through every action instead of two small, separately-readable ones.
 *
 * Both "Mark as read" and "Mark as unread" are always offered, unconditionally
 * — a mixed selection (some read, some unread) has no single "current" state
 * to flip, so there's no natural single toggle label the way the single-thread
 * menu has. This mirrors how the single-thread menu never disables an option
 * based on state either.
 */
export function ThreadSelectionMenu({
  threads,
  currentTab,
  onDone,
  children,
}: {
  /** Every currently-selected thread, in selection order. */
  threads: RailThread[];
  currentTab: ContactTab;
  /** Called after any action fires, to clear the selection — a completed bulk
   * action leaves nothing meaningful still "selected". */
  onDone: () => void;
  children: React.ReactNode;
}) {
  const { position, open, close } = useContextMenu();
  const { trash, setRead, reclassify } = useMessageActions();

  const threadIds = threads.map((t) => t.id);
  const count = threadIds.length;
  const description = `${count} conversation${count === 1 ? "" : "s"}`;

  const actions: MenuAction[] = [
    {
      id: "mark-read",
      label: "Mark as read",
      onSelect: () => {
        void setRead({ threadIds }, true);
        onDone();
      },
    },
    {
      id: "mark-unread",
      label: "Mark as unread",
      onSelect: () => {
        void setRead({ threadIds }, false);
        onDone();
      },
    },
    ...MOVE_TARGETS.filter((t) => t.tab !== currentTab).map((t) => ({
      id: `move-${t.tab}`,
      label: t.label,
      onSelect: () => {
        void reclassify({ threadIds }, t.tab, description);
        onDone();
      },
    })),
    {
      id: "trash",
      label: `Delete ${description}`,
      destructive: true,
      onSelect: () => {
        void trash({ threadIds }, description);
        onDone();
      },
    },
  ];

  return (
    <div onContextMenu={open}>
      {children}
      <ContextMenu position={position} actions={actions} onClose={close} />
    </div>
  );
}
