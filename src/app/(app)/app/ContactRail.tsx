import Link from "next/link";
import { RailRow } from "@/components/ui/RailRow";
import { railTimestamp } from "@/lib/format";
import type { ContactTab } from "@/lib/types";
import { NewMessageButton } from "./NewMessageButton";
import type { ContactSuggestion } from "./NewMessage";
import { ThreadRowMenu } from "./ThreadRowMenu";

export interface RailThread {
  id: string;
  /** Primary participant address, used for avatar color + fallback label. */
  primaryAddress: string;
  /** Human label: display name, or a readable fallback. */
  label: string;
  /** Extra participants beyond the first, for group threads. */
  extraParticipants: number;
  snippet: string;
  lastMessageAt: string | null;
  /**
   * Drives the unread treatment (bold name, brighter snippet, coral dot).
   * True when the thread's newest message is newer than the user's Wompy read
   * watermark for it, except for the conversation currently open — that one is
   * being marked read as it renders.
   */
  unread: boolean;
  /** Company logo URL when the sender is a confident brand; else null. */
  logoUrl: string | null;
}

/**
 * Left contact rail — dark spruce, full height, flush against the top bar.
 *
 * Spruce is the only dark tone in the palette: the rail, the top bar, and the
 * outgoing bubbles all share it. Row content is therefore light-on-dark.
 */
export function ContactRail({
  threads,
  selectedId,
  activeTab,
  contactSuggestions,
}: {
  threads: RailThread[];
  selectedId: string | null;
  activeTab: ContactTab;
  contactSuggestions: ContactSuggestion[];
}) {
  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-spruce-edge bg-spruce shadow-[2px_0_16px_rgba(0,0,0,0.15)]">
      {/* Search lives in the top bar, where it spans both panes rather than
          looking scoped to the contact list. */}
      <div className="px-4 pb-2.5 pt-4">
        <NewMessageButton contacts={contactSuggestions} />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-4">
        {threads.length === 0 ? (
          <p className="px-3 py-6 text-sm text-on-spruce-muted">
            {activeTab === "contact"
              ? "No conversations yet. Mail from real people lands here — reply to someone, or email yourself to test."
              : activeTab === "spam"
                ? "No spam. Anything Gmail flags lands here for review — nothing is deleted."
                : "Nothing here yet. Newsletters, receipts, and other one-way mail land here."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {threads.map((thread) => {
              const active = thread.id === selectedId;
              return (
                <li key={thread.id}>
                  <ThreadRowMenu
                    threadId={thread.id}
                    label={thread.label}
                    unread={thread.unread}
                    currentTab={activeTab}
                  >
                  <Link
                    href={`/app?tab=${activeTab}&thread=${thread.id}`}
                    aria-current={active ? "true" : undefined}
                    className="block"
                  >
                    <RailRow
                      address={thread.primaryAddress}
                      label={thread.label}
                      timestamp={railTimestamp(thread.lastMessageAt)}
                      snippet={thread.snippet}
                      unread={thread.unread}
                      active={active}
                      extraParticipants={thread.extraParticipants}
                      logoUrl={thread.logoUrl}
                    />
                  </Link>
                  </ThreadRowMenu>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}
