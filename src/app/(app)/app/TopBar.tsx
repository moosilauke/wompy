"use client";

import { SyncStatus, useSyncPoller } from "./SyncPoller";
import { AccountMenu } from "./AccountMenu";
import { Search } from "./Search";
import { MoreMenu } from "./MoreMenu";
import { BrandMark } from "@/components/ui/BrandMark";
import type { AppView } from "@/lib/types";

/**
 * The Contacts/Companies split is the product's primary navigation, not a
 * filter bolted onto one inbox: Contacts get the chat view, Companies get a
 * classic list. They stay as first-class tabs.
 */
const TABS: { id: AppView; label: string }[] = [
  { id: "contact", label: "Contacts" },
  { id: "company", label: "Companies" },
];

/**
 * Views you visit deliberately rather than live in. Collapsed behind "More" so
 * they don't each spend a permanent slot in the nav.
 */
const MORE_VIEWS: { id: AppView; label: string }[] = [
  { id: "sent", label: "Sent" },
  { id: "trash", label: "Trash" },
  // Quarantine for Gmail-flagged spam. Kept visible (not deleted) so false
  // positives stay recoverable.
  { id: "spam", label: "Spam" },
];

/**
 * Top bar: 64px of spruce, flush against the sidebar below it (same color, no
 * seam). Mint is reserved for the logo mark and the active-tab chip; coral does
 * the primary-action job on the right.
 */
export function TopBar({
  userEmail,
  isAdmin,
  lastSyncedAt,
  activeTab,
  counts,
  onSelectTab,
}: {
  userEmail: string | null;
  isAdmin: boolean;
  lastSyncedAt: string | null;
  activeTab: AppView;
  counts: Record<AppView, number>;
  onSelectTab: (tab: AppView) => void;
}) {
  // Polling lives here so the manual control (in the account menu) and the
  // status indicator (in the bar) share one source of truth. The server-seeded
  // last-synced time flows in here and is advanced by the hook after each sync.
  const { runSync, syncing, lastError, needsReauth, lastSyncedAt: syncedAt } =
    useSyncPoller(lastSyncedAt);

  return (
    <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-spruce-edge bg-spruce px-7 shadow-[0_2px_12px_rgba(0,0,0,0.05)]">
      <div className="flex items-center gap-7">
        <BrandMark />

        <nav className="flex items-center gap-1">
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                aria-current={active ? "page" : undefined}
                className={`rounded-[10px] px-[13px] py-[7px] text-[13px] font-bold transition-colors ${
                  active
                    ? "bg-[oklch(0.8_0.13_175_/_0.25)] text-white"
                    : "text-on-spruce-muted hover:text-white"
                }`}
              >
                {tab.label}
                <span className="ml-1.5 font-semibold opacity-70">
                  {counts[tab.id]}
                </span>
              </button>
            );
          })}

          <MoreMenu
            items={MORE_VIEWS.map((v) => ({ ...v, count: counts[v.id] }))}
            activeView={activeTab}
            onSelect={onSelectTab}
          />
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <Search />
        {/* Only renders when something needs attention. */}
        <SyncStatus lastError={lastError} needsReauth={needsReauth} />
        <AccountMenu
          userEmail={userEmail}
          isAdmin={isAdmin}
          lastSyncedAt={syncedAt}
          onSync={() => void runSync()}
          syncing={syncing}
        />
      </div>
    </header>
  );
}
