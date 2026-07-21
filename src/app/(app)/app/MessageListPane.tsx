import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { bubbleTime, dayDividerLabel } from "@/lib/format";
import type { AppView } from "@/lib/types";

export interface ListedMessage {
  id: string;
  /** Thread to open when the row is clicked, if the thread still exists. */
  threadId: string | null;
  /** Tab that thread lives in, so the link lands on the right view. */
  threadTab: string | null;
  /** Who the message is from or to, already resolved to a display label. */
  personLabel: string;
  personAddress: string;
  subject: string | null;
  preview: string;
  sentAt: string | null;
}

/**
 * Flat, cross-cutting message list — Sent and Trash.
 *
 * These are filters over messages rather than categories of thread: a sent
 * message belongs to a conversation that also lives in Contacts, and trashing
 * one message doesn't move its thread anywhere. Showing them as a rail of
 * conversations would imply a thread had moved when it hadn't, so they get a
 * flat list instead, and each row links back to where the conversation lives.
 */
export function MessageListPane({
  view,
  messages,
}: {
  view: AppView;
  messages: ListedMessage[];
}) {
  const copy = COPY[view] ?? COPY.sent;

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-reading-pane">
      <div className="flex h-[76px] shrink-0 items-center border-b border-black/[0.06] bg-cream px-7 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-[17px] font-bold text-text-body">
            {copy.title}
          </h2>
          <p className="text-[13px] text-[#8a8375]">
            {messages.length > 0 ? copy.subtitle : copy.emptySubtitle}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-text-muted">{copy.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((msg) => (
              <li key={msg.id}>
                <RowShell message={msg}>
                  <Avatar
                    address={msg.personAddress}
                    label={msg.personLabel}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="truncate text-[14px] font-bold text-text-body">
                        {msg.personLabel}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-text-muted-3">
                        {dayDividerLabel(msg.sentAt)} · {bubbleTime(msg.sentAt)}
                      </span>
                    </div>
                    {msg.subject && (
                      <p className="truncate text-[13px] font-semibold text-text-muted">
                        {msg.subject}
                      </p>
                    )}
                    <p className="truncate text-[13px] text-text-muted-3">
                      {msg.preview}
                    </p>
                  </div>
                </RowShell>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * Rows link to their conversation when it still exists. A trashed message whose
 * every sibling is also trashed has no live thread to open, so that row is
 * rendered inert rather than as a link that goes nowhere.
 */
function RowShell({
  message,
  children,
}: {
  message: ListedMessage;
  children: React.ReactNode;
}) {
  const className =
    "flex w-full items-center gap-3 rounded-[14px] border border-black/[0.06] bg-white p-3.5 text-left shadow-[0_2px_8px_rgba(0,0,0,0.05)] transition-colors";

  if (!message.threadId || !message.threadTab) {
    return <div className={className}>{children}</div>;
  }

  return (
    <Link
      href={`/app?tab=${message.threadTab}&thread=${message.threadId}`}
      className={`${className} hover:bg-black/[0.02]`}
    >
      {children}
    </Link>
  );
}

const COPY: Record<
  string,
  { title: string; subtitle: string; emptySubtitle: string; empty: string }
> = {
  sent: {
    title: "Sent",
    subtitle: "Messages you've sent, newest first",
    emptySubtitle: "Nothing sent yet",
    empty: "Messages you send will appear here.",
  },
  trash: {
    title: "Trash",
    subtitle: "Deleted messages — recoverable for 30 days in Gmail",
    emptySubtitle: "Nothing deleted",
    empty: "Deleted messages will appear here.",
  },
};
