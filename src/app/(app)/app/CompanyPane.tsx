import { Avatar } from "./Avatar";
import { bubbleTime, dayDividerLabel } from "@/lib/format";

export interface CompanyMessage {
  id: string;
  subject: string | null;
  body: string | null;
  snippet: string | null;
  htmlOnly: boolean;
  sentAt: string | null;
}

export interface CompanyThread {
  id: string;
  label: string;
  primaryAddress: string;
  participants: string[];
}

/**
 * Companies reading view — a classic list/read layout, not chat bubbles.
 *
 * Per the MVP plan this tab shows content as-is: subjects are visible (unlike
 * the chat view, which hides them), and nothing is truncated or stripped. This
 * is where receipts, newsletters, and one-directional mail live.
 *
 * `body_html` is still never injected — untrusted remote content. HTML-only mail
 * falls back to its snippet with a marker until the sanitizing/stripping step.
 */
export function CompanyPane({
  thread,
  messages,
  isSpam = false,
}: {
  thread: CompanyThread | null;
  messages: CompanyMessage[];
  isSpam?: boolean;
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
      <div className="flex h-[76px] shrink-0 items-center gap-3.5 border-b border-black/[0.06] bg-cream px-7 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <Avatar
          address={thread.primaryAddress}
          label={thread.label}
          size={44}
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

      {/* Classic list: one card per message, subject foremost. */}
      <div className="flex-1 overflow-y-auto px-7 py-6">
        {isSpam && (
          <p className="mb-4 rounded-[14px] border border-coral/25 bg-coral/10 px-4 py-3 text-[13px] text-text-muted">
            Gmail flagged this sender as spam. Nothing here is deleted — if this
            is a false positive, replying to them in Gmail will move them to
            Contacts on the next sync.
          </p>
        )}
        {messages.length === 0 ? (
          <p className="text-center text-sm text-text-muted">
            Nothing from this sender yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((msg) => (
              <li
                key={msg.id}
                className="rounded-[14px] border border-black/[0.06] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.05)]"
              >
                <div className="mb-1.5 flex items-baseline justify-between gap-4">
                  <h3 className="min-w-0 flex-1 font-display text-[15px] font-bold text-text-body">
                    {msg.subject ?? "(no subject)"}
                  </h3>
                  <span className="shrink-0 text-[11.5px] text-text-muted-3">
                    {dayDividerLabel(msg.sentAt)} · {bubbleTime(msg.sentAt)}
                  </span>
                </div>

                <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.5] text-text-muted">
                  {msg.body ?? msg.snippet ?? ""}
                </p>

                {msg.htmlOnly && (
                  <p className="mt-2 text-[11px] text-text-muted-3">
                    HTML email — preview only
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
