import { Avatar } from "@/components/ui/Avatar";
import { CompanyCard } from "./CompanyCard";
import type { AttachmentInfo } from "@/components/ui/AttachmentChip";
import type { ReactionSummary } from "@/components/ui/ReactionBadges";
import { PaneSkeleton } from "./PaneSkeleton";
import { ScrollToLatest } from "./ScrollToLatest";

export interface CompanyMessage {
  id: string;
  subject: string | null;
  /** Excerpt: quoted history and signature already removed. */
  body: string | null;
  /** Cleaned full body, shown in the modal when the excerpt was trimmed. */
  fullBody: string;
  truncated: boolean;
  htmlOnly: boolean;
  attachments: AttachmentInfo[];
  reactions: ReactionSummary[];
  sentAt: string | null;
}

export interface CompanyThread {
  id: string;
  label: string;
  primaryAddress: string;
  participants: string[];
  logoUrl: string | null;
}

/**
 * Companies reading view — a classic list/read layout, not chat bubbles.
 *
 * Per the MVP plan this tab shows content as-is: subjects are visible (unlike
 * the chat view, which hides them), and nothing is truncated or stripped. This
 * is where receipts, newsletters, and one-directional mail live.
 *
 * Cards render text and never inject `body_html` into the app's DOM. This is
 * also the tab where "View original" matters most — newsletters and receipts
 * are the graphical mail — and it renders the sender's real HTML sanitized,
 * inside a sandboxed frame (see MessageModal).
 */
export function CompanyPane({
  thread,
  messages,
  isSpam = false,
  loading = false,
  hasOlder = false,
  loadingOlder = false,
  olderCount = 0,
  alwaysLoadImages = false,
  onLoadOlder,
}: {
  thread: CompanyThread | null;
  messages: CompanyMessage[];
  isSpam?: boolean;
  /** Messages still in flight for a sender whose header is already known —
   * see ReadingPane, same arrangement. */
  loading?: boolean;
  /** More history exists than what's loaded — see ReadingPane. */
  hasOlder?: boolean;
  loadingOlder?: boolean;
  olderCount?: number;
  /** Settings preference, forwarded to each message's "View original" modal. */
  alwaysLoadImages?: boolean;
  onLoadOlder?: () => void;
}) {
  if (!thread) {
    return (
      <section className="flex flex-1 items-center justify-center bg-reading-pane">
        <p className="text-sm text-text-muted">
          {isSpam ? "Select a sender to review." : "Select a sender to read."}
        </p>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-reading-pane">
      {/* Header */}
      <div className="flex h-[76px] shrink-0 items-center gap-3.5 border-b border-black/[0.06] bg-cream px-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)] md:px-7">
        <Avatar
          address={thread.primaryAddress}
          label={thread.label}
          size={44}
          logoUrl={thread.logoUrl}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="truncate font-display text-[17px] font-bold text-text-body">
            {thread.label}
          </h2>
          <p className="truncate text-[13px] text-[#8a8375]">
            {thread.participants.join(", ")}
          </p>
        </div>
      </div>

      {/* Classic list: one card per message, subject foremost. Placeholder
          cards while they load — the header above is already real. */}
      {loading && messages.length === 0 ? (
        <PaneSkeleton />
      ) : (
      <ScrollToLatest
        threadId={thread.id}
        messageCount={messages.length}
        olderCount={olderCount}
        className="flex-1 overflow-y-auto px-4 py-4 md:px-7 md:py-6"
      >
        {isSpam && (
          <p className="mb-4 rounded-[14px] border border-coral/25 bg-coral/10 px-4 py-3 text-[13px] text-text-muted">
            Gmail flagged this sender as spam. Nothing here is deleted — if this
            is a false positive, replying to them in Gmail will move them to
            Contacts on the next sync.
          </p>
        )}
        {/* Walks back through senders with more history than one page — see
            ReadingPane; the query has always been capped. */}
        {hasOlder && (
          <div className="mb-3 flex justify-center">
            <button
              type="button"
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className="rounded-full border border-black/[0.08] bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-text-muted shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-colors hover:text-text-body disabled:opacity-50"
            >
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        )}

        {messages.length === 0 ? (
          <p className="text-center text-sm text-text-muted">
            Nothing from this sender yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((msg) => (
              <li key={msg.id}>
                <CompanyCard
                  message={msg}
                  threadLabel={thread.label}
                  alwaysLoadImages={alwaysLoadImages}
                />
              </li>
            ))}
          </ul>
        )}
      </ScrollToLatest>
      )}
    </section>
  );
}
