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
 * Read state is Wompy's own now — a per-thread watermark in Supabase, no Gmail
 * round-trip — so this is a single cheap write. It fires only when the thread is
 * actually unread, and only once per thread per session, so re-renders (the sync
 * poller's router.refresh every 2 minutes) don't re-request.
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
        // Refresh so the rail drops the unread treatment. hasUnread gated this,
        // so there was a real change to reflect.
        router.refresh();
      } catch {
        // A failed mark-read isn't worth interrupting reading over; reopening
        // the thread will try again.
        handled.current.delete(threadId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [threadId, hasUnread, router]);

  return null;
}
