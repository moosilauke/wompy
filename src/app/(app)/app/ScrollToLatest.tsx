"use client";

import { useEffect, useRef } from "react";

/**
 * Scrollable message list that stays pinned to its newest message.
 *
 * Conversations read top-to-bottom with the latest at the end, so landing at
 * the top would mean scrolling past old mail to find what just arrived.
 *
 * Owns the scroll container rather than reaching for a parent element, so the
 * element it scrolls is the one it rendered.
 *
 * Two behaviours, deliberately different:
 *   - switching threads jumps instantly (no animation to sit through)
 *   - new mail in the thread you're already reading scrolls smoothly, but only
 *     if you were already at the bottom. Yanking the view while someone reads
 *     back through history is worse than making them scroll.
 */
export function ScrollToLatest({
  threadId,
  messageCount,
  className,
  children,
}: {
  threadId: string;
  messageCount: number;
  className?: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastThreadId = useRef<string | null>(null);
  const wasAtBottom = useRef(true);

  // Record whether the user sits at the bottom, so the effect below can tell
  // "reading the latest" from "scrolled back through history".
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      const distance =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      // A tolerance: fractional scroll positions rarely land at exactly 0.
      wasAtBottom.current = distance < 80;
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const threadChanged = lastThreadId.current !== threadId;
    lastThreadId.current = threadId;

    if (threadChanged) {
      // A new view, not a change to the one being read: jump, don't animate.
      container.scrollTop = container.scrollHeight;
      wasAtBottom.current = true;
      return;
    }

    if (wasAtBottom.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [threadId, messageCount]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
