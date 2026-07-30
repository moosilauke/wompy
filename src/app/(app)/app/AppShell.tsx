"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "./TopBar";
import { ContactRail, type RailThread } from "./ContactRail";
import { MobileRailDrawer } from "./MobileRailDrawer";
import { useThreadSelection } from "./useThreadSelection";
import { RailMutationsProvider } from "./RailMutations";
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
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState<AppView>(initialTab);
  const [lastServerTab, setLastServerTab] = useState<AppView>(initialTab);

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

  const selectTab = (tab: AppView) => {
    if (tab === activeTab) return;
    setSelectedTab(tab);

    // replaceState rather than router.push: this must not trigger a server
    // render, and it keeps tab switching out of the back-button history, which
    // matches how a mail client behaves.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    url.searchParams.delete("thread");
    window.history.replaceState(null, "", url);

    // Thread views render instantly from the rail data already held for every
    // tab; the server fetch behind them only fills in the reading pane. Sent and
    // Trash have no client-side data, so they genuinely wait on the server.
    router.replace(`/app?tab=${tab}`, { scroll: false });
  };

  // Sent and Trash are flat message lists with no conversation rail. Held as a
  // narrowed value rather than a boolean so the rail's props typecheck.
  const railTab = isThreadView(activeTab) ? activeTab : null;

  // Ctrl/shift-click multi-select (see useThreadSelection). One instance
  // serves whichever tab is currently active — only one rail tab is ever
  // visible at a time, so there's nothing to keep separate per tab beyond
  // clearing it on switch, which selectTab already does below. The open
  // thread (selectedId) is passed in as the implicit starting anchor.
  const selection = useThreadSelection(
    railTab ? threadsByTab[railTab].map((t) => t.id) : [],
    selectedId,
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
  const removeThreads = useCallback((threadIds: string[]) => {
    if (threadIds.length === 0) return;
    const ids = new Set(threadIds);
    setThreadsByTab((prev) => {
      const next = {} as Record<ContactTab, RailThread[]>;
      for (const tab of Object.keys(prev) as ContactTab[]) {
        next[tab] = prev[tab].filter((t) => !ids.has(t.id));
      }
      return next;
    });
  }, []);

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

  return (
    <RailMutationsProvider value={{ removeThreads, patchThreads }}>
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
          {railTab && (
            <>
              {/* Desktop: inline sidebar, as always. */}
              <div className="hidden md:flex">
                <ContactRail
                  threads={threadsByTab[railTab]}
                  selectedId={selectedId}
                  activeTab={railTab}
                  contactSuggestions={contactSuggestions}
                  hasMore={cursorByTab[railTab] !== null}
                  loadingMore={loadingMore === railTab}
                  onLoadMore={() => loadMore(railTab)}
                  selectedIds={selection.selected}
                  onRowClick={selection.handleClick}
                  onSelectionDone={selection.clear}
                />
              </div>
              {/* Mobile: overlay drawer, so the reading pane is the default view. */}
              <MobileRailDrawer>
                <ContactRail
                  threads={threadsByTab[railTab]}
                  selectedId={selectedId}
                  activeTab={railTab}
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
            </>
          )}
          <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </RailMutationsProvider>
  );
}
