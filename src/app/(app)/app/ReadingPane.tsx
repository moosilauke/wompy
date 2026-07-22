import { Avatar } from "@/components/ui/Avatar";
import { Bubble, BubbleRow, DayDivider } from "@/components/ui/Bubble";
import { Composer } from "./Composer";
import { MessageBody } from "./MessageBody";
import { ReactionPicker } from "./ReactionPicker";
import { ScrollToLatest } from "./ScrollToLatest";
import {
  AttachmentList,
  type AttachmentInfo,
} from "@/components/ui/AttachmentChip";
import {
  ReactionBadges,
  type ReactionSummary,
} from "@/components/ui/ReactionBadges";
import { bubbleTime, dayDividerLabel, dayKey } from "@/lib/format";

export interface PaneMessage {
  id: string;
  /** True when the signed-in user sent it (right-aligned, spruce bubble). */
  outgoing: boolean;
  /** Excerpt shown in the bubble: quoted history and signature already removed. */
  body: string | null;
  /** Cleaned full body, shown in the modal when the excerpt was trimmed. */
  fullBody: string;
  /** True when anything was removed, so an expand affordance is needed. */
  truncated: boolean;
  /** True when the message had only an HTML part (see note in the bubble). */
  htmlOnly: boolean;
  attachments: AttachmentInfo[];
  reactions: ReactionSummary[];
  sentAt: string | null;
}

export interface PaneThread {
  id: string;
  label: string;
  primaryAddress: string;
  participants: string[];
  /** Whether the add-reaction control is offered for this conversation. */
  canReact: boolean;
}

/**
 * Right reading pane: contact header, day dividers, and chat bubbles.
 *
 * Bubbles carry an asymmetric radius so each has a "tail" on the side it came
 * from, and a soft shadow — outgoing ones tinted spruce to match their fill.
 * Timestamps sit just outside the bubble, per the design reference.
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

      {/* Messages */}
      <ScrollToLatest
        threadId={thread.id}
        messageCount={messages.length}
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-10 py-7"
      >
        {messages.length === 0 ? (
          <p className="text-center text-sm text-text-muted">
            No messages in this conversation yet.
          </p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="contents">
              {showDividerFor.has(msg.id) && (
                <DayDivider label={dayDividerLabel(msg.sentAt)} />
              )}

              <BubbleRow
                outgoing={msg.outgoing}
                timestamp={bubbleTime(msg.sentAt)}
                // Extra bottom room so a badge overlapping the bubble's lower
                // edge isn't clipped by the next row.
                className={msg.reactions.length > 0 ? "mb-3" : undefined}
              >
                {/* Positioning context for the reaction badge and picker, plus
                    `group` so the picker button appears on hover. */}
                <div className="group relative">
                  <Bubble outgoing={msg.outgoing}>
                    <MessageBody
                      messageId={msg.id}
                      excerpt={msg.body ?? ""}
                      full={msg.fullBody}
                      truncated={msg.truncated}
                      title={msg.outgoing ? "Your message" : thread.label}
                      subtitle={dayDividerLabel(msg.sentAt)}
                    >
                      {msg.htmlOnly && (
                        <p
                          className={`mt-2 text-[11px] ${
                            msg.outgoing ? "text-white/60" : "text-text-muted-3"
                          }`}
                        >
                          HTML email — preview only
                        </p>
                      )}
                      <AttachmentList
                        attachments={msg.attachments}
                        outgoing={msg.outgoing}
                      />
                    </MessageBody>
                  </Bubble>

                  {/* Bottom-left, nudged up and in so it slightly overlaps the
                      bubble — a reaction is a response TO the message, and the
                      overlap reads as "attached to this one" rather than as a
                      separate element. */}
                  {msg.reactions.length > 0 && (
                    <div className="absolute -bottom-2.5 left-2 z-10">
                      <ReactionBadges reactions={msg.reactions} />
                    </div>
                  )}

                  {/* Only when the conversation's recipients can render
                      reactions — otherwise sending would produce a plain email. */}
                  {thread.canReact && (
                    <ReactionPicker
                      messageId={msg.id}
                      outgoing={msg.outgoing}
                    />
                  )}
                </div>
              </BubbleRow>
            </div>
          ))
        )}
      </ScrollToLatest>

      <Composer threadId={thread.id} recipientLabel={thread.label} />
    </section>
  );
}
