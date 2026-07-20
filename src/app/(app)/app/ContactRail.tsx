import Link from "next/link";
import { Avatar } from "./Avatar";
import { railTimestamp } from "@/lib/format";
import type { ContactTab } from "@/lib/types";

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
  /** Drives the unread treatment (bold name, brighter snippet, coral dot).
   * Read/unread isn't tracked in the schema yet, so this is always false for
   * now — the styling is here and ready for when that data exists. */
  unread: boolean;
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
}: {
  threads: RailThread[];
  selectedId: string | null;
  activeTab: ContactTab;
}) {
  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-spruce-edge bg-spruce shadow-[2px_0_16px_rgba(0,0,0,0.15)]">
      {/* Decorative search — real search is a later step. */}
      <div className="px-4 pb-2.5 pt-4">
        <div
          className="flex items-center gap-2 rounded-[14px] bg-spruce-raised px-3.5 py-2.5"
          aria-hidden
        >
          <span className="h-4 w-4 shrink-0 rounded-full border-2 border-on-spruce-muted" />
          <span className="text-sm font-semibold text-on-spruce-muted">
            Search people or messages
          </span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-4">
        {threads.length === 0 ? (
          <p className="px-3 py-6 text-sm text-on-spruce-muted">
            {activeTab === "contact"
              ? "No conversations yet. Mail from real people lands here — reply to someone, or email yourself to test."
              : "Nothing here yet. Newsletters, receipts, and other one-way mail land here."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {threads.map((thread) => {
              const active = thread.id === selectedId;
              return (
                <li key={thread.id}>
                  <Link
                    href={`/app?tab=${activeTab}&thread=${thread.id}`}
                    aria-current={active ? "true" : undefined}
                    className={`flex items-center gap-[11px] rounded-xl p-2.5 transition-colors ${
                      active
                        ? "bg-[oklch(0.8_0.13_175_/_0.25)]"
                        : "hover:bg-white/[0.06]"
                    }`}
                  >
                    <Avatar
                      address={thread.primaryAddress}
                      label={thread.label}
                      size={44}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={`truncate text-sm text-on-spruce ${
                            thread.unread ? "font-extrabold" : "font-bold"
                          }`}
                        >
                          {thread.label}
                          {thread.extraParticipants > 0 && (
                            <span className="font-semibold text-on-spruce-muted">
                              {" "}
                              +{thread.extraParticipants}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs text-on-spruce-muted">
                          {railTimestamp(thread.lastMessageAt)}
                        </span>
                      </span>

                      <span className="flex min-w-0 items-center justify-between gap-2">
                        <span
                          className={`min-w-0 flex-1 truncate text-[12.5px] ${
                            thread.unread
                              ? "font-bold text-on-spruce-bright"
                              : "font-medium text-on-spruce-muted"
                          }`}
                        >
                          {thread.snippet}
                        </span>
                        {thread.unread && (
                          <span
                            aria-label="Unread"
                            className="h-[9px] w-[9px] shrink-0 rounded-full bg-coral"
                          />
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}
