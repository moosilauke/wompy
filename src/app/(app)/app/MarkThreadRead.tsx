"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  // The thread that was open on the previous render. Mark-read fires only when
  // the open thread changes, so flipping the current thread's own unread state
  // (marking it unread while open) never triggers a re-read.
  const previousThreadId = useRef<string | null>(null);

  useEffect(() => {
    const changedThread = previousThreadId.current !== threadId;
    previousThreadId.current = threadId;

    // Only on arriving at a different thread, and only if it's unread.
    if (!changedThread || !hasUnread) return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read", threadId }),
        });
        if (cancelled || !res.ok) return;
        // Refresh so the rail drops the unread treatment.
        router.refresh();
      } catch {
        // A failed mark-read isn't worth interrupting reading over; reopening
        // the thread will try again.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [threadId, hasUnread, router]);

  return null;
}
