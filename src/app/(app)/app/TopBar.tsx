"use client";

import { signOut } from "../actions";
import { SyncPoller } from "./SyncPoller";
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
  activeTab,
  counts,
  onSelectTab,
}: {
  userEmail: string | null;
  activeTab: AppView;
  counts: Record<AppView, number>;
  onSelectTab: (tab: AppView) => void;
}) {
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

      <div className="flex items-center gap-4">
        <Search />
        <SyncPoller />
        {userEmail && (
          <span className="hidden text-[13px] font-bold text-on-spruce-muted md:inline">
            {userEmail}
          </span>
        )}
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-full bg-coral px-[18px] py-[9px] text-[13px] font-extrabold text-white shadow-[0_4px_12px_oklch(0.5_0.12_25_/_0.4)] transition-opacity hover:opacity-90"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
