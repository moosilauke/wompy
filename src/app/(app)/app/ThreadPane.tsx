"use client";

import { useEffect, useRef, useState } from "react";
import { ReadingPane, type PaneMessage, type PaneThread } from "./ReadingPane";
import { CompanyPane, type CompanyMessage } from "./CompanyPane";
import { MarkThreadRead } from "./MarkThreadRead";
import { mergePendingMessages, usePendingMessages } from "./PendingMessages";
import type { RailThread } from "./ContactRail";
import type { ContactTab } from "@/lib/types";

/**
 * The reading pane, with the open conversation owned client-side.
 *
 * Clicking a rail row used to be a full server navigation: it re-ran the whole
 * force-dynamic page — every tab's rail, the tab counts, the contact list, the
 * read watermarks — to change what was in this pane, with no loading state, so
 * the old conversation sat there and the clicked row didn't even highlight.
 *
 * Now the click paints the header immediately from the RailThread the client
 * already holds (label, address, participants, logo — everything the header
 * needs), and only the messages are fetched, from /api/thread/[id]. The server
 * still renders the first conversation on a cold load or deep link; this takes
 * over from there.
 */
export function ThreadPane({
  tab,
  serverThread,
  serverMessages,
  openThread,
  isSpam,
}: {
  tab: ContactTab;
  /** The conversation the server rendered — the cold-load/deep-link path. */
  serverThread: PaneThread | null;
  serverMessages: PaneMessage[] | CompanyMessage[];
  /** The row the user clicked, if they've clicked one this session. Null means
   * the server's choice still stands. */
  openThread: RailThread | null;
  isSpam: boolean;
}) {
  const { pendingByThread, retryPending } = usePendingMessages();

  // Messages for the thread named by `loadedId`. The two move together so a
  // render can never pair one thread's id with another's messages.
  const [loaded, setLoaded] = useState<{
    id: string;
    messages: PaneMessage[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastOpenId, setLastOpenId] = useState<string | null>(null);
  // Bumped to re-run the fetch for the SAME thread — after a send, so the real
  // message replaces the optimistic bubble. Goes through the same effect (and
  // therefore the same race guard) rather than being a second fetch path.
  const [reloadToken, setReloadToken] = useState(0);

  // Guards against out-of-order responses: click A, click B, and if A's slower
  // request lands second its messages would replace B's. Only the newest
  // request's id is honoured (same approach as Search's debounce guard).
  const requestId = useRef(0);

  // Derive during render rather than resetting in an effect — the same pattern
  // AppShell uses for tab/selection, and what keeps a thread's messages from
  // ever rendering under a different thread's header for one frame.
  const openId = openThread?.id ?? null;
  if (openId !== lastOpenId) {
    setLastOpenId(openId);
    // A thread that was open is no longer (or a different one is): whatever is
    // loaded belongs to the old one. Dropping it here means the next render
    // shows the skeleton, not stale bubbles.
    if (loaded && loaded.id !== openId) setLoaded(null);
    // The skeleton is therefore up before the request below is even made.
    setLoading(openId !== null);
  }

  useEffect(() => {
    if (!openId) return;

    // Only ever superseded, never aborted: a response that lost the race is
    // discarded on arrival rather than cancelled, which keeps the bookkeeping
    // to one counter and costs nothing but a wasted parse.
    const id = ++requestId.current;
    let active = true;

    void (async () => {
      try {
        const res = await fetch(`/api/thread/${openId}`);
        if (!active || id !== requestId.current) return;
        if (!res.ok) {
          // A failed RELOAD leaves what's on screen alone — the conversation
          // is still the right one and its messages are still valid. Only a
          // failed initial load empties the pane, where the alternative is
          // showing the previous thread's messages under this one's header.
          setLoaded((prev) =>
            prev?.id === openId ? prev : { id: openId, messages: [] },
          );
          setLoading(false);
          return;
        }
        const messages = (await res.json()).messages ?? [];
        if (!active || id !== requestId.current) return;
        setLoaded({ id: openId, messages });
        setLoading(false);
      } catch {
        if (!active || id !== requestId.current) return;
        setLoaded((prev) =>
          prev?.id === openId ? prev : { id: openId, messages: [] },
        );
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [openId, reloadToken]);

  // The clicked row wins over the server's until the server catches up.
  const thread: PaneThread | null = openThread
    ? {
        id: openThread.id,
        label: openThread.label,
        primaryAddress: openThread.primaryAddress,
        participants: openThread.participants,
        canReact: openThread.canReact,
        logoUrl: openThread.logoUrl,
      }
    : serverThread;

  // Only messages that belong to the thread actually on screen — the id pairing
  // is what makes a mismatch impossible rather than merely unlikely.
  const base = openThread
    ? (loaded?.id === openThread.id ? loaded.messages : [])
    : serverMessages;

  // Bubbles for messages sent this session that the server hasn't confirmed
  // yet. Only the chat view gets these — Companies/Spam are one-directional
  // and have no composer to send from.
  const shown =
    tab === "contact" && thread
      ? mergePendingMessages(
          base as PaneMessage[],
          pendingByThread.get(thread.id),
        )
      : base;

  // Marks the open conversation read. Lives here rather than in page.tsx now
  // that opening one doesn't re-render the page: this is the only place that
  // knows a conversation was opened client-side. `unread` comes off the rail
  // row, so the request fires exactly when the server-rendered path did.
  const markRead = openThread ? (
    <MarkThreadRead threadId={openThread.id} hasUnread={openThread.unread} />
  ) : null;

  if (tab === "contact") {
    return (
      <>
        {markRead}
        <ReadingPane
          thread={thread}
          messages={shown as PaneMessage[]}
          loading={loading}
          // Re-read the conversation once the server has the sent message, so
          // the real one takes the optimistic bubble's place. No skeleton for
          // this pass — the bubbles are already on screen.
          onSent={() => setReloadToken((n) => n + 1)}
          onRetry={(tempId) =>
            void retryPending(tempId, {
              onSent: () => setReloadToken((n) => n + 1),
            })
          }
        />
      </>
    );
  }

  return (
    <>
      {markRead}
      <CompanyPane
        thread={thread}
        messages={shown as CompanyMessage[]}
        isSpam={isSpam}
        loading={loading}
      />
    </>
  );
}
