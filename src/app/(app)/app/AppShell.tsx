"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "./TopBar";
import { ContactRail, type RailThread } from "./ContactRail";
import type { ContactSuggestion } from "./NewMessage";
import { isThreadView, type AppView, type ContactTab } from "@/lib/types";

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
  initialTab,
  counts,
  railByTab,
  selectedId,
  contactSuggestions,
  children,
}: {
  userEmail: string | null;
  isAdmin: boolean;
  initialTab: AppView;
  counts: Record<AppView, number>;
  railByTab: Record<ContactTab, RailThread[]>;
  selectedId: string | null;
  contactSuggestions: ContactSuggestion[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState<AppView>(initialTab);
  const [lastServerTab, setLastServerTab] = useState<AppView>(initialTab);

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
        activeTab={activeTab}
        counts={counts}
        onSelectTab={selectTab}
      />
      <div className="flex min-h-0 flex-1">
        {railTab && (
          <ContactRail
            threads={railByTab[railTab]}
            selectedId={selectedId}
            activeTab={railTab}
            contactSuggestions={contactSuggestions}
          />
        )}
        {children}
      </div>
    </div>
  );
}
