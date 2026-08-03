"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "./TopBar";
import { ContactRail, type RailThread } from "./ContactRail";
import { MobileRailDrawer } from "./MobileRailDrawer";
import { useThreadSelection } from "./useThreadSelection";
import { useMediaQuery, MD_BREAKPOINT } from "./useMediaQuery";
import { RailMutationsProvider, type RemovedThread } from "./RailMutations";
import { ThreadPane } from "./ThreadPane";
import type { PaneThread } from "./ReadingPane";
import type { MappedMessage } from "@/lib/email/pane";
import type { ContactSuggestion } from "./NewMessage";
import { isThreadView, type AppView, type ContactTab } from "@/lib/types";

export interface RailCursor {
  lastMessageAt: string | null;
  id: string;
}

/**
 * Combine a background-refreshed server payload with whatever's already
 * accumulated client-side (the server's fresh first page plus any "Load
 * more" pages fetched since). The fresh copy wins for any thread present in
 * both — it reflects newer read state, snippets, etc. — but nothing already
 * loaded is dropped just because it fell outside the server's bounded first
 * page. Re-sorted by lastMessageAt (matching the server's own ordering, and
 * every "Load more" page's) since a thread in the fresh payload may have
 * just received new mail and jumped to the top.
 */
function mergeFreshRail(
  prev: Record<ContactTab, RailThread[]>,
  fresh: Record<ContactTab, RailThread[]>,
): Record<ContactTab, RailThread[]> {
  const merged = {} as Record<ContactTab, RailThread[]>;
  for (const tab of Object.keys(fresh) as ContactTab[]) {
    const byId = new Map(prev[tab].map((t) => [t.id, t]));
    for (const t of fresh[tab]) byId.set(t.id, t);
    merged[tab] = [...byId.values()].sort((a, b) => {
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });
  }
  return merged;
}

/**
 * Client shell owning the active tab.
 *
 * Tabs used to be `<Link href="/app?tab=...">`, so every switch was a server
 * round-trip that re-fetched all threads only to filter them differently — the
 * server already loads every tab's threads on each render, because the tab
 * counts need them. The rail lists for all three tabs are passed in together,
 * so switching is now instant and does no I/O.
 *
 * The URL is still kept in sync (history.replaceState, not a navigation) so the
 * view stays linkable and a reload lands on the same tab. Selecting a thread is
 * still a real navigation: that genuinely needs different data from the server.
 */
export function AppShell({
  userEmail,
  isAdmin,
  lastSyncedAt,
  initialTab,
  counts,
  railByTab,
  initialCursors,
  selectedId,
  contactSuggestions,
  serverThread,
  serverMessages,
  serverOlderCursor,
  children,
}: {
  userEmail: string | null;
  isAdmin: boolean;
  lastSyncedAt: string | null;
  initialTab: AppView;
  counts: Record<AppView, number>;
  railByTab: Record<ContactTab, RailThread[]>;
  /** Per-tab keyset cursor for "Load more" — null means that tab's first
   * page was already the whole list (fewer than RAIL_PAGE_SIZE rows). */
  initialCursors: Record<ContactTab, RailCursor | null>;
  selectedId: string | null;
  contactSuggestions: ContactSuggestion[];
  /** The conversation the server rendered, for the cold-load and deep-link
   * path. Once the user clicks a row, the client's choice takes over. */
  serverThread: PaneThread | null;
  /** The loader's superset shape, which satisfies both panes — see
   * lib/email/pane.ts. Kept wide here so nothing needs casting on the way
   * down. */
  serverMessages: MappedMessage[];
  /** Set when the server-rendered conversation has more history than one page. */
  serverOlderCursor: string | null;
  /** Sent/Trash only — thread views render their pane internally. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState<AppView>(initialTab);
  const [lastServerTab, setLastServerTab] = useState<AppView>(initialTab);

  // The rail used to render TWICE — once inline for desktop, once inside the
  // drawer for mobile — with only CSS hiding the irrelevant one. That doubled
  // every row's cost (each carries a context menu subscribing to four
  // contexts), so at 200 threads the app paid for 400. Only one is mounted
  // now. The server guesses desktop: its branch is a plain inline sidebar,
  // whereas the drawer's is fixed-position overlay chrome (backdrop, handle,
  // body-scroll lock) that would visibly flash if SSR guessed it wrong.
  const isDesktop = useMediaQuery(MD_BREAKPOINT, true);

  // Accumulated rail state, seeded from the server's first page per tab and
  // grown by loadMore. Reseeded whenever the server sends a fresh railByTab
  // (a real page load/refresh) — see the derive-during-render block below,
  // same pattern already used for lastServerTab/selectedTab.
  const [threadsByTab, setThreadsByTab] =
    useState<Record<ContactTab, RailThread[]>>(railByTab);
  const [cursorByTab, setCursorByTab] =
    useState<Record<ContactTab, RailCursor | null>>(initialCursors);
  const [lastServerRailByTab, setLastServerRailByTab] = useState(railByTab);
  const [loadingMore, setLoadingMore] = useState<ContactTab | null>(null);

  // The conversation the user clicked, if any. Null means "whatever the server
  // chose" — a cold load, a deep link, or back/forward. Holding the whole
  // RailThread (not just the id) is what lets the pane paint its header on the
  // same frame as the click: everything the header shows is already here.
  //
  // Kept as a snapshot AND re-resolved against live rail state below, so a
  // mark-read patch or a background refresh that changes the row is reflected
  // in the open pane rather than leaving it on a stale copy.
  const [openThread, setOpenThread] = useState<RailThread | null>(null);
  const [lastServerSelectedId, setLastServerSelectedId] = useState(selectedId);

  // A fresh server render — most often a BACKGROUND one: the sync poller
  // (~2min) or the backfill poller (~1.5-4s while a backfill is active) both
  // end every step in router.refresh(), same as a mark-read effect. None of
  // those are the user navigating anywhere; they just mean "the server has
  // slightly newer data for the tabs you're already looking at." Compared by
  // reference: railByTab is a new array identity only when page.tsx actually
  // re-ran its queries.
  //
  // This used to fully replace threadsByTab/cursorByTab with the server's
  // fresh (bounded, first-page-only) payload — which silently discarded any
  // "Load more" pages the user had fetched beyond that, AND (once multi-select
  // existed) blew away an in-progress ctrl/shift selection anchored to a row
  // that was only present because of "Load more". A background refresh has no
  // business doing either: it should update what the server now knows about
  // the threads already loaded, not shrink the list back down.
  if (railByTab !== lastServerRailByTab) {
    setLastServerRailByTab(railByTab);
    setThreadsByTab((prev) => mergeFreshRail(prev, railByTab));
    // The cursor is NOT reset here: "Load more" pages already fetched are
    // being kept (see mergeFreshRail), so the tab still has exactly as much
    // more left to load as before a background refresh touched it. Only a
    // real tab switch (selectTab, below) intentionally drops back to the
    // server's cursor, because that's a real navigation to a possibly
    // different view of the data.
  }

  const loadMore = useCallback(
    async (tab: ContactTab) => {
      const cursor = cursorByTab[tab];
      if (!cursor || loadingMore) return;
      setLoadingMore(tab);
      try {
        const res = await fetch("/api/rail/more", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tab, cursor }),
        });
        if (!res.ok) return;
        const { threads: more, nextCursor } = (await res.json()) as {
          threads: RailThread[];
          nextCursor: RailCursor | null;
        };
        setThreadsByTab((prev) => ({ ...prev, [tab]: [...prev[tab], ...more] }));
        setCursorByTab((prev) => ({ ...prev, [tab]: nextCursor }));
      } finally {
        setLoadingMore(null);
      }
    },
    [cursorByTab, loadingMore],
  );

  // Derive during render rather than syncing in an effect: when the server
  // sends a different tab (a back/forward navigation, or the poller's
  // router.refresh()), that wins over the local choice. Adjusting state during
  // render is React's documented pattern for this, and avoids the extra pass a
  // setState-in-effect would cause.
  let activeTab = selectedTab;
  if (initialTab !== lastServerTab) {
    setLastServerTab(initialTab);
    setSelectedTab(initialTab);
    activeTab = initialTab;
  }

  // Same pattern for the open conversation: when the server sends a different
  // selectedId than last time — a back/forward, or a deep link — that's a real
  // navigation and it wins over the locally-clicked thread. A background
  // refresh re-sends the SAME selectedId, so this correctly ignores those and
  // leaves the user's clicked conversation open.
  let currentOpen = openThread;
  if (selectedId !== lastServerSelectedId) {
    setLastServerSelectedId(selectedId);
    setOpenThread(null);
    currentOpen = null;
  }

  // Opening a conversation: state first so the row highlights and the header
  // paints this frame, then the URL (replaceState, not a navigation — the
  // server render this would trigger is exactly what we're avoiding), then
  // ThreadPane fetches just the messages.
  const openConversation = useCallback((thread: RailThread) => {
    setOpenThread(thread);
    const url = new URL(window.location.href);
    url.searchParams.set("thread", thread.id);
    window.history.replaceState(null, "", url);
  }, []);

  const selectTab = (tab: AppView) => {
    if (tab === activeTab) return;
    setSelectedTab(tab);
    // The URL drops ?thread= below, so the locally-open conversation has to go
    // with it — otherwise it would stay in the pane under a different tab.
    setOpenThread(null);

    // replaceState rather than router.push: this must not trigger a server
    // render, and it keeps tab switching out of the back-button history, which
    // matches how a mail client behaves.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    url.searchParams.delete("thread");
    window.history.replaceState(null, "", url);

    // Only Sent and Trash need the server: they're flat message lists with no
    // client-side data. Thread views render the rail from state already held
    // for every tab, and the pane now fetches its own messages, so the server
    // render this used to trigger for them was pure waste — twelve queries to
    // produce a page the client had already drawn.
    if (!isThreadView(tab)) {
      router.replace(`/app?tab=${tab}`, { scroll: false });
    }
  };

  // Sent and Trash are flat message lists with no conversation rail. Held as a
  // narrowed value rather than a boolean so the rail's props typecheck.
  const railTab = isThreadView(activeTab) ? activeTab : null;

  // What the rail highlights. The clicked thread wins over the server's choice
  // so the row goes active on the same frame as the click, rather than when a
  // server render eventually agrees.
  const effectiveSelectedId = currentOpen?.id ?? selectedId;

  // Prefer the live rail row over the click-time snapshot, so patches that
  // land after opening (mark-read clearing the dot, a refresh bringing a newer
  // snippet) show up in the pane's header instead of being frozen at whatever
  // the row looked like when it was clicked. Falls back to the snapshot for a
  // row that has since left the rail — trashing the open conversation removes
  // it, and the pane shouldn't blank out mid-undo.
  const liveOpenThread =
    currentOpen && railTab
      ? (threadsByTab[railTab].find((t) => t.id === currentOpen.id) ??
        currentOpen)
      : currentOpen;

  // Ctrl/shift-click multi-select (see useThreadSelection). One instance
  // serves whichever tab is currently active — only one rail tab is ever
  // visible at a time, so there's nothing to keep separate per tab beyond
  // clearing it on switch, which selectTab already does below. The open
  // thread (selectedId) is passed in as the implicit starting anchor.
  const selection = useThreadSelection(
    railTab ? threadsByTab[railTab].map((t) => t.id) : [],
    effectiveSelectedId,
  );

  const selectTabWithClear = (tab: AppView) => {
    selection.clear();
    selectTab(tab);
  };

  // Removes ids a just-completed action (trash, move-to-tab) is KNOWN to
  // have affected — see RailMutations.tsx for why a background refresh alone
  // can't safely do this (it can't tell "deleted" apart from "beyond the
  // loaded page"). Filters every tab rather than just the active one: a
  // multi-select move can send some threads to a tab the user isn't even
  // looking at.
  // Returns the rows it removed so the caller can put them back if the action
  // fails — see RailMutations.tsx.
  //
  // The returned list is read from the CURRENT render's threadsByTab, not from
  // inside the setState updater: React runs updaters lazily during the
  // re-render, so anything collected in there would still be empty by the time
  // this returned. Depending on threadsByTab means a new identity per rail
  // change, which is fine — the value is captured at click time, and every
  // caller invokes it and uses the result immediately.
  const removeThreads = useCallback(
    (threadIds: string[]): RemovedThread[] => {
      if (threadIds.length === 0) return [];
      const ids = new Set(threadIds);

      const removed: RemovedThread[] = [];
      for (const tab of Object.keys(threadsByTab) as ContactTab[]) {
        for (const thread of threadsByTab[tab]) {
          if (ids.has(thread.id)) removed.push({ tab, thread });
        }
      }

      setThreadsByTab((prev) => {
        const next = {} as Record<ContactTab, RailThread[]>;
        for (const tab of Object.keys(prev) as ContactTab[]) {
          next[tab] = prev[tab].filter((t) => !ids.has(t.id));
        }
        return next;
      });

      return removed;
    },
    [threadsByTab],
  );

  // Applies a known change (e.g. read/unread) to specific thread ids
  // immediately — see RailMutations.tsx for why this can't be left to a
  // background refresh alone once a thread is beyond the server's fresh
  // first page.
  const patchThreads = useCallback(
    (threadIds: string[], patch: Partial<RailThread>) => {
      if (threadIds.length === 0) return;
      const ids = new Set(threadIds);
      setThreadsByTab((prev) => {
        const next = {} as Record<ContactTab, RailThread[]>;
        for (const tab of Object.keys(prev) as ContactTab[]) {
          next[tab] = prev[tab].map((t) =>
            ids.has(t.id) ? { ...t, ...patch } : t,
          );
        }
        return next;
      });
    },
    [],
  );

  // Puts optimistically-removed rows back when the action they were removed
  // for fails (or is undone). Re-sorted by lastMessageAt so a restored row
  // lands where it belongs rather than at the end — same ordering the server
  // and mergeFreshRail use. Ids already present are left alone, so a restore
  // racing a refresh that already re-delivered the row can't duplicate it.
  const restoreThreads = useCallback((removed: RemovedThread[]) => {
    if (removed.length === 0) return;
    setThreadsByTab((prev) => {
      const next = { ...prev };
      for (const tab of Object.keys(prev) as ContactTab[]) {
        const forTab = removed.filter((r) => r.tab === tab);
        if (forTab.length === 0) continue;
        const present = new Set(prev[tab].map((t) => t.id));
        const missing = forTab
          .filter((r) => !present.has(r.thread.id))
          .map((r) => r.thread);
        if (missing.length === 0) continue;
        next[tab] = [...prev[tab], ...missing].sort((a, b) => {
          const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return bt - at;
        });
      }
      return next;
    });
  }, []);

  return (
    <RailMutationsProvider
      value={{ removeThreads, patchThreads, restoreThreads }}
    >
      <div className="flex h-screen flex-col overflow-hidden">
        <TopBar
          userEmail={userEmail}
          isAdmin={isAdmin}
          lastSyncedAt={lastSyncedAt}
          activeTab={activeTab}
          counts={counts}
          onSelectTab={selectTabWithClear}
        />
        <div className="flex min-h-0 flex-1">
          {railTab &&
            (isDesktop ? (
              /* Desktop: inline sidebar, as always. Mounted only when the
                 viewport is actually wide, so no `md:` hiding is needed —
                 and none is wanted: it would blank the rail on a narrow
                 viewport for the one render before hydration corrects. */
              <div className="flex">
                <ContactRail
                  threads={threadsByTab[railTab]}
                  selectedId={effectiveSelectedId}
                  activeTab={railTab}
                  onOpen={openConversation}
                  contactSuggestions={contactSuggestions}
                  hasMore={cursorByTab[railTab] !== null}
                  loadingMore={loadingMore === railTab}
                  onLoadMore={() => loadMore(railTab)}
                  selectedIds={selection.selected}
                  onRowClick={selection.handleClick}
                  onSelectionDone={selection.clear}
                />
              </div>
            ) : (
              /* Mobile: overlay drawer, so the reading pane is the default view. */
              <MobileRailDrawer>
                <ContactRail
                  threads={threadsByTab[railTab]}
                  selectedId={effectiveSelectedId}
                  activeTab={railTab}
                  onOpen={openConversation}
                  contactSuggestions={contactSuggestions}
                  className="w-full"
                  hasMore={cursorByTab[railTab] !== null}
                  loadingMore={loadingMore === railTab}
                  onLoadMore={() => loadMore(railTab)}
                  selectedIds={selection.selected}
                  onRowClick={selection.handleClick}
                  onSelectionDone={selection.clear}
                />
              </MobileRailDrawer>
            ))}
          <div className="flex min-h-0 min-w-0 flex-1">
            {/* Thread views own their pane so a click can swap it without a
                server render. Sent and Trash are flat lists with no client
                data, so they stay server-rendered as children. */}
            {railTab ? (
              <ThreadPane
                tab={railTab}
                serverThread={serverThread}
                serverMessages={serverMessages}
                serverOlderCursor={serverOlderCursor}
                openThread={liveOpenThread}
                isSpam={railTab === "spam"}
              />
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    </RailMutationsProvider>
  );
}
