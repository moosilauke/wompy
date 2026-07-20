import { Avatar } from "./Avatar";
import { bubbleTime, dayDividerLabel, dayKey } from "@/lib/format";

export interface PaneMessage {
  id: string;
  /** True when the signed-in user sent it (right-aligned, spruce bubble). */
  outgoing: boolean;
  /** Best available body text; null when only HTML was available. */
  body: string | null;
  /** Fallback preview when there's no plain-text body. */
  snippet: string | null;
  /** True when the message had only an HTML part (see note in the bubble). */
  htmlOnly: boolean;
  sentAt: string | null;
}

export interface PaneThread {
  id: string;
  label: string;
  primaryAddress: string;
  participants: string[];
}

/**
 * Right reading pane: contact header, day dividers, and message bubbles.
 *
 * Body rendering deliberately never injects `body_html` — it's untrusted remote
 * content, and the MVP plan calls for stripping images/signatures before display.
 * HTML-only mail shows its snippet with a marker until those rules are built.
 */
export function ReadingPane({
  thread,
  messages,
}: {
  thread: PaneThread | null;
  messages: PaneMessage[];
}) {
  if (!thread) {
    return (
      <section className="flex flex-1 items-center justify-center bg-reading-pane">
        <p className="text-sm text-text-muted">
          Select a conversation to read it.
        </p>
      </section>
    );
  }

  // Precompute where day dividers go, rather than mutating during render.
  const showDividerFor = new Set<string>();
  let previousDay = "";
  for (const msg of messages) {
    const thisDay = dayKey(msg.sentAt);
    if (thisDay !== previousDay) showDividerFor.add(msg.id);
    previousDay = thisDay;
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-reading-pane">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-black/[0.06] bg-cream px-5 py-3">
        <Avatar
          address={thread.primaryAddress}
          label={thread.label}
          size={40}
        />
        <div className="min-w-0">
          <h2 className="truncate font-display text-[17px] font-bold text-text-body">
            {thread.label}
          </h2>
          <p className="truncate text-xs text-text-muted">
            {thread.participants.join(", ")}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-text-muted">
            No messages in this conversation yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((msg) => {
              const showDivider = showDividerFor.has(msg.id);

              return (
                <li key={msg.id}>
                  {showDivider && (
                    <div className="my-3 flex justify-center">
                      <span className="rounded-full bg-black/[0.05] px-3 py-1 text-[11px] font-bold tracking-wide text-text-muted">
                        {dayDividerLabel(msg.sentAt)}
                      </span>
                    </div>
                  )}

                  <div
                    className={`flex ${msg.outgoing ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={
                        msg.outgoing
                          ? "max-w-[62%] rounded-[16px_16px_4px_16px] bg-spruce px-3.5 py-2.5 text-white shadow-[0_2px_8px_rgba(0,0,0,0.05)]"
                          : "max-w-[62%] rounded-[4px_16px_16px_16px] border border-black/[0.06] bg-bubble-incoming px-3.5 py-2.5 text-text-body shadow-[0_2px_8px_rgba(0,0,0,0.05)]"
                      }
                    >
                      <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
                        {msg.body ?? msg.snippet ?? ""}
                      </p>

                      {msg.htmlOnly && (
                        <p
                          className={`mt-1.5 text-[11px] ${
                            msg.outgoing ? "text-white/60" : "text-text-muted-3"
                          }`}
                        >
                          HTML email — preview only
                        </p>
                      )}

                      <p
                        className={`mt-1 text-right text-[11px] ${
                          msg.outgoing ? "text-white/55" : "text-text-muted-3"
                        }`}
                      >
                        {bubbleTime(msg.sentAt)}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Composer — intentionally inert: reply/send is a later step. */}
      <div className="border-t border-black/[0.06] bg-cream px-5 py-3">
        <div className="flex items-center gap-2">
          <div
            className="flex-1 rounded-full bg-black/[0.04] px-4 py-2.5 text-sm text-text-muted-3"
            aria-disabled
            title="Replying arrives in a later step"
          >
            Replying isn’t wired up yet
          </div>
          <button
            type="button"
            disabled
            aria-label="Send (coming soon)"
            title="Replying arrives in a later step"
            className="flex h-10 w-10 shrink-0 cursor-not-allowed items-center justify-center rounded-full bg-coral/50 text-white"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M1 8l14-6-6 14-2-6-6-2z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}
