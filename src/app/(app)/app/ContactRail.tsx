import Link from "next/link";
import { Avatar } from "./Avatar";
import { railTimestamp } from "@/lib/format";

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
}

/**
 * Left contact rail (280px, cream). One row per conversation, newest first.
 * The selected row gets the tinted mint background from the design spec.
 */
export function ContactRail({
  threads,
  selectedId,
}: {
  threads: RailThread[];
  selectedId: string | null;
}) {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-black/[0.06] bg-cream">
      {/* Decorative search — real search is a later step. */}
      <div className="p-3">
        <div
          className="flex items-center rounded-full bg-black/[0.04] px-4 py-2 text-sm text-text-muted-3"
          aria-hidden
        >
          Search people or messages
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto pb-3">
        {threads.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-muted">
            No conversations yet. New mail will appear here after it syncs.
          </p>
        ) : (
          <ul>
            {threads.map((thread) => {
              const active = thread.id === selectedId;
              return (
                <li key={thread.id}>
                  <Link
                    href={`/app?thread=${thread.id}`}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "bg-mint/20"
                        : "hover:bg-black/[0.03]"
                    }`}
                  >
                    <Avatar
                      address={thread.primaryAddress}
                      label={thread.label}
                      size={40}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-bold text-text-body">
                          {thread.label}
                          {thread.extraParticipants > 0 && (
                            <span className="font-semibold text-text-muted">
                              {" "}
                              +{thread.extraParticipants}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-[11px] text-text-muted-3">
                          {railTimestamp(thread.lastMessageAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-text-muted">
                        {thread.snippet}
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
