"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "./TopBar";
import { ContactRail, type RailThread } from "./ContactRail";
import { MobileRailDrawer } from "./MobileRailDrawer";
import type { ContactSuggestion } from "./NewMessage";
import { isThreadView, type AppView, type ContactTab } from "@/lib/types";

export interface RailCursor {
  lastMessageAt: string | null;
  id: string;
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

  // A fresh server render (new mail via the sync poller's router.refresh(),
  // or a real navigation) replaces the accumulated state with the server's
  // new first page — any "Load more" progress from before this render is
  // intentionally not preserved across it, matching how a tab switch already
  // resets to the server's view today. Compared by reference: railByTab is a
  // new array identity only when page.tsx actually re-ran its queries.
  if (railByTab !== lastServerRailByTab) {
    setLastServerRailByTab(railByTab);
    setThreadsByTab(railByTab);
    setCursorByTab(initialCursors);
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

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        userEmail={userEmail}
        isAdmin={isAdmin}
        lastSyncedAt={lastSyncedAt}
        activeTab={activeTab}
        counts={counts}
        onSelectTab={selectTab}
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
              />
            </MobileRailDrawer>
          </>
        )}
        <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
