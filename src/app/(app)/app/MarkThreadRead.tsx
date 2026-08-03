"use client";

import { useEffect, useRef } from "react";
import { useRailMutations } from "./RailMutations";

/**
 * Marks the open conversation read — on open.
 *
 * The trigger is *navigating into* an unread thread, not the open thread merely
 * being unread. That distinction is the whole behaviour: marking the thread
 * you're currently reading as unread must leave it unread (a "deal with this
 * later" gesture you make while still looking at it), so this fires only when
 * the selected thread id CHANGES to an unread one.
 *
 * Read state is Wompy's own — a per-thread watermark in Supabase, no Gmail
 * round-trip — so the mark is a single cheap write.
 */
export function MarkThreadRead({
  threadId,
  hasUnread,
}: {
  threadId: string;
  hasUnread: boolean;
}) {
  const { patchThreads } = useRailMutations();
  // The thread that was open on the previous render. Mark-read fires only when
  // the open thread changes, so flipping the current thread's own unread state
  // (marking it unread while open) never triggers a re-read.
  const previousThreadId = useRef<string | null>(null);

  useEffect(() => {
    const changedThread = previousThreadId.current !== threadId;
    previousThreadId.current = threadId;

    // Only on arriving at a different thread, and only if it's unread.
    if (!changedThread || !hasUnread) return;

    // Drop the unread treatment now, in the same frame the thread opens,
    // rather than after the write returns. Patching the rail directly (not
    // router.refresh()) also means this doesn't re-run the whole page for
    // what is a one-field change — and it reaches threads past the server's
    // fresh first page, which a refresh can't (see RailMutations.tsx).
    patchThreads([threadId], { unread: false });

    void (async () => {
      try {
        await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read", threadId }),
        });
      } catch {
        // A failed mark-read isn't worth interrupting reading over, nor worth
        // flipping the row back to unread under someone who is reading it —
        // reopening the thread will try again.
      }
    })();
  }, [threadId, hasUnread, patchThreads]);

  return null;
}
