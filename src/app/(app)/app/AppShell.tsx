"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "./TopBar";
import { ContactRail, type RailThread } from "./ContactRail";
import type { ContactSuggestion } from "./NewMessage";
import type { ContactTab } from "@/lib/types";

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
  initialTab,
  counts,
  railByTab,
  selectedId,
  contactSuggestions,
  children,
}: {
  userEmail: string | null;
  initialTab: ContactTab;
  counts: Record<ContactTab, number>;
  railByTab: Record<ContactTab, RailThread[]>;
  selectedId: string | null;
  contactSuggestions: ContactSuggestion[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState<ContactTab>(initialTab);
  const [lastServerTab, setLastServerTab] = useState<ContactTab>(initialTab);

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

  const selectTab = (tab: ContactTab) => {
    if (tab === activeTab) return;
    setSelectedTab(tab);

    // replaceState rather than router.push: this must not trigger a server
    // render, and it keeps tab switching out of the back-button history, which
    // matches how a mail client behaves.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    url.searchParams.delete("thread");
    window.history.replaceState(null, "", url);

    // The reading pane is server-rendered for the selected thread, which
    // belongs to the previous tab. Fetch the new tab's default thread in the
    // background; the rail is already correct and stays interactive.
    router.replace(`/app?tab=${tab}`, { scroll: false });
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        userEmail={userEmail}
        activeTab={activeTab}
        counts={counts}
        onSelectTab={selectTab}
      />
      <div className="flex min-h-0 flex-1">
        <ContactRail
          threads={railByTab[activeTab]}
          selectedId={selectedId}
          activeTab={activeTab}
          contactSuggestions={contactSuggestions}
        />
        {children}
      </div>
    </div>
  );
}
