"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Marks the open conversation read.
 *
 * Fires on open rather than after a dwell timer: immediate is what every mail
 * client does, and a delay mostly produces the confusing case where a thread you
 * looked at stays bold.
 *
 * The request is a no-op server-side when nothing in the thread is unread, so
 * re-rendering (the sync poller calls router.refresh every 2 minutes) costs
 * nothing. `router.refresh()` runs only when something actually changed, so the
 * poller and this can't drive each other in a loop.
 */
export function MarkThreadRead({
  threadId,
  hasUnread,
}: {
  threadId: string;
  hasUnread: boolean;
}) {
  const router = useRouter();
  // Threads already handled this session, so re-renders don't re-request.
  const handled = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!hasUnread || handled.current.has(threadId)) return;
    handled.current.add(threadId);

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read", threadId }),
        });
        if (cancelled || !res.ok) return;

        const data = await res.json();
        // Only refresh when messages actually changed, so an already-read
        // thread doesn't trigger a pointless re-render.
        if ((data.messageIds?.length ?? 0) > 0) router.refresh();
      } catch {
        // A failed mark-read is not worth interrupting reading over; the next
        // sync will reconcile with Gmail either way.
        handled.current.delete(threadId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [threadId, hasUnread, router]);

  return null;
}
