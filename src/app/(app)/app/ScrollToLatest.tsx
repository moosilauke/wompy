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
 * Three behaviours, deliberately different:
 *   - switching threads jumps instantly (no animation to sit through)
 *   - new mail in the thread you're already reading scrolls smoothly, but only
 *     if you were already at the bottom. Yanking the view while someone reads
 *     back through history is worse than making them scroll.
 *   - loading EARLIER messages holds the reading position exactly where it
 *     was. The content above grows, so staying still means compensating for
 *     the height that appeared — otherwise the page would lurch, which is the
 *     opposite of what someone reading upward asked for.
 */
export function ScrollToLatest({
  threadId,
  messageCount,
  olderCount = 0,
  className,
  children,
}: {
  threadId: string;
  messageCount: number;
  /** How many of `messageCount` were loaded by paging BACKWARDS through the
   * conversation. An increase means content was prepended, which is the one
   * case that must hold the scroll position rather than move it. */
  olderCount?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastThreadId = useRef<string | null>(null);
  const wasAtBottom = useRef(true);
  // Height before the latest render, so a prepend can be told apart from an
  // append and compensated for.
  const lastScrollHeight = useRef(0);
  const lastScrollTop = useRef(0);
  const lastOlderCount = useRef(0);

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
      lastScrollTop.current = container.scrollTop;
      lastScrollHeight.current = container.scrollHeight;
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
      lastScrollHeight.current = container.scrollHeight;
      lastScrollTop.current = container.scrollTop;
      lastOlderCount.current = olderCount;
      return;
    }

    // Content appeared ABOVE the reading position (loading earlier messages):
    // the container grew, but everything the user was looking at moved down by
    // that amount. Adding it back to scrollTop leaves the message they were
    // reading exactly where it was. Told by `olderCount` rather than inferred
    // from the height change, because an append while scrolled up looks
    // identical from geometry alone.
    const grewBy = container.scrollHeight - lastScrollHeight.current;

    if (olderCount > lastOlderCount.current && grewBy > 0) {
      container.scrollTop = lastScrollTop.current + grewBy;
    } else if (wasAtBottom.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }

    lastScrollHeight.current = container.scrollHeight;
    lastScrollTop.current = container.scrollTop;
    lastOlderCount.current = olderCount;
  }, [threadId, messageCount, olderCount]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
