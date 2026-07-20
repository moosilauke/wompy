"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
}: {
  threadId: string;
  recipientLabel: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [fullEmail, setFullEmail] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = MAX_CHAT_LENGTH - body.length;
  const overLimit = !fullEmail && remaining < 0;
  const canSend = body.trim().length > 0 && !overLimit && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, body, fullEmail }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.detail ?? json?.error ?? "Couldn’t send.");
        return;
      }
      setBody("");
      setFullEmail(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t send.");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter makes a newline — chat convention.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="shrink-0 px-8 pb-6 pt-4">
      {error && (
        <p className="mb-2 text-[12.5px] font-bold text-coral">{error}</p>
      )}

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
