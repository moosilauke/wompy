"use client";

import { useState } from "react";
import { usePendingMessages } from "./PendingMessages";

const MAX_CHAT_LENGTH = 365;

/**
 * Message composer.
 *
 * The 365-character cap is a deliberate product feature, not a technical limit:
 * it pushes toward chat norms rather than letter-writing. The "write a full
 * email instead" toggle is the explicit escape hatch from the MVP plan — the
 * constraint is opinionated, not a cage.
 */
export function Composer({
  threadId,
  recipientLabel,
  onSent,
}: {
  threadId: string;
  recipientLabel: string;
  /** Fires once the server confirms, so the pane can pull the real message
   * in. Not a router.refresh(): the bubble is already on screen, and only
   * this conversation's messages need re-reading. */
  onSent?: () => void;
}) {
  const { addPending, sendPending } = usePendingMessages();
  const [body, setBody] = useState("");
  const [fullEmail, setFullEmail] = useState(false);

  const remaining = MAX_CHAT_LENGTH - body.length;
  const overLimit = !fullEmail && remaining < 0;
  // There is no "sending" state any more: the box empties the moment a send
  // starts, so the button is already disabled by having nothing to send, and
  // firing off two messages in a row is simply two sends in flight — the way a
  // chat app behaves.
  const canSend = body.trim().length > 0 && !overLimit;

  function send() {
    if (!canSend) return;

    // Everything the user typed is captured and the box is cleared BEFORE the
    // request, so the bubble appears and the composer is ready for the next
    // message on the same frame. Previously the text sat frozen in the
    // textarea across four sequential round-trips.
    const sentBody = body;
    const sentFullEmail = fullEmail;
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    setBody("");
    setFullEmail(false);

    const message = {
      tempId,
      threadId,
      body: sentBody,
      sentAt: new Date().toISOString(),
      fullEmail: sentFullEmail,
    };

    addPending(message);

    // The same object is handed straight to the send rather than being looked
    // up by id — the add above hasn't been applied to state yet in this tick,
    // so a lookup would find nothing and silently skip the request.
    //
    // The provider owns the request so a retry on a failed bubble can re-run
    // it without the composer (which may since have been unmounted, or moved
    // to another conversation) being involved.
    //
    // No onError handler: a failure is reported on the bubble itself, next to
    // the message it's about and next to the retry. An error line down here
    // would be a second voice saying the same thing, detached from it.
    void sendPending(message, { onSent });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter makes a newline — chat convention.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="shrink-0 px-4 pb-4 pt-3 md:px-8 md:pb-6 md:pt-4">
      {/* No error line here: a send that fails is reported on its own bubble,
          with the retry, rather than by a banner detached from the message it
          refers to. The character counter below is the only inline feedback
          this box needs. */}
      <div className="flex items-end gap-2.5 rounded-[22px] border border-black/[0.06] bg-white py-2.5 pl-[18px] pr-3 shadow-[0_4px_18px_rgba(0,0,0,0.07)]">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={`Write to ${recipientLabel}…`}
          className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[14.5px] font-semibold text-text-body outline-none placeholder:text-[#a39c8c]"
        />

        <div className="flex shrink-0 items-center gap-2 pb-0.5">
          {!fullEmail && (
            <span
              className={`text-[11.5px] font-bold ${
                remaining < 0
                  ? "text-coral"
                  : remaining <= 40
                    ? "text-text-muted"
                    : "text-text-muted-3"
              }`}
            >
              {remaining}
            </span>
          )}

          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            aria-label="Send"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-coral text-white shadow-[0_3px_10px_oklch(0.5_0.12_25_/_0.35)] transition-opacity disabled:opacity-40"
          >
            <span
              aria-hidden
              className="ml-0.5 h-0 w-0 border-y-[6px] border-l-[9px] border-y-transparent border-l-white"
            />
          </button>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => setFullEmail((v) => !v)}
          className="text-[12px] font-bold text-text-muted underline decoration-dotted underline-offset-2 hover:text-spruce"
        >
          {fullEmail
            ? "Back to a short message"
            : "Write a full email instead"}
        </button>
        {overLimit && (
          <span className="text-[12px] font-bold text-coral">
            {Math.abs(remaining)} over — shorten it or write a full email.
          </span>
        )}
      </div>
    </div>
  );
}
