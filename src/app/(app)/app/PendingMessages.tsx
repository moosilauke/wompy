"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { PaneMessage } from "./ReadingPane";

/**
 * Messages the user just sent, before the server has them.
 *
 * Sending is a chain of round-trips — auth, account lookup, the Gmail send,
 * then a second Gmail call to read the message back — and until this existed
 * the user's own words sat frozen in the composer for the whole of it. Now the
 * bubble appears on the same frame as the send and this holds it until the
 * real message arrives.
 *
 * Same shape as OptimisticReactions, and for the same reason: the pending
 * bubble has to survive a refresh and outlive the composer that created it, so
 * it can't live in component state.
 *
 * A pending message is cleared once the server's copy shows up, matched on the
 * Gmail message id the send returns.
 *
 * Deliberately, a message in flight is styled exactly like a sent one. Sends
 * essentially always succeed, and a "sending…" treatment on the normal case
 * would advertise the very latency this exists to hide. Only a genuine failure
 * gets a treatment: the bubble stays where it is, says "Not sent", and offers
 * a retry — so nothing the user wrote ever disappears, whichever way it goes.
 */

export interface PendingMessage {
  /** Local id, distinct from any server id — the bubble needs a React key
   * before the message exists anywhere else. */
  tempId: string;
  threadId: string;
  body: string;
  sentAt: string;
  /** Whether the 365-char chat cap was opted out of, kept so a retry sends
   * exactly what the first attempt did. */
  fullEmail?: boolean;
  /** Set once the send returns; how the server's copy is recognized. */
  gmailMessageId?: string;
  /** The send failed. Until it's retried the bubble stays put and says so —
   * the message is not lost, it just hasn't gone anywhere. */
  failed?: boolean;
}

interface PendingMessagesValue {
  pendingByThread: Map<string, PendingMessage[]>;
  addPending: (message: PendingMessage) => void;
  /** Sends a pending message. Lives here rather than in the composer so a
   * retry runs the identical request — by then the composer may be unmounted
   * or pointed at another conversation. Takes the message itself, not its id,
   * because the composer adds and sends in one tick. */
  sendPending: (
    message: PendingMessage,
    handlers?: { onSent?: () => void; onError?: (message: string) => void },
  ) => Promise<void>;
  /** Re-sends a message that failed, by id — the retry affordance on a bubble
   * has the id and nothing else. */
  retryPending: (
    tempId: string,
    handlers?: { onSent?: () => void },
  ) => Promise<void>;
  clearPending: (tempId: string) => void;
}

const Context = createContext<PendingMessagesValue | null>(null);

export function PendingMessagesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pending, setPending] = useState<PendingMessage[]>([]);

  const addPending = useCallback((message: PendingMessage) => {
    setPending((prev) => [...prev, message]);
  }, []);

  const clearPending = useCallback((tempId: string) => {
    setPending((prev) => prev.filter((p) => p.tempId !== tempId));
  }, []);

  const markFailed = useCallback((tempId: string) => {
    setPending((prev) =>
      prev.map((p) => (p.tempId === tempId ? { ...p, failed: true } : p)),
    );
  }, []);

  /**
   * Send a message that's already in the pending list.
   *
   * Takes the whole message rather than looking it up by id: the composer adds
   * it and sends in the same tick, so any lookup — through a ref synced in an
   * effect, or through `pending` itself — would still be reading the array
   * from BEFORE the add and find nothing. That failed silently: no request, no
   * failure marking, just a bubble sitting there looking sent. Passing the
   * value removes the timing question entirely.
   */
  const sendPending = useCallback(
    async (
      message: PendingMessage,
      handlers?: { onSent?: () => void; onError?: (message: string) => void },
    ) => {
      const { tempId } = message;

      // Clear any previous failure so a retry looks like an ordinary send
      // again while it's in flight, rather than sitting there still marked.
      setPending((prev) =>
        prev.map((p) => (p.tempId === tempId ? { ...p, failed: false } : p)),
      );

      try {
        const res = await fetch("/api/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: message.threadId,
            body: message.body,
            fullEmail: message.fullEmail ?? false,
          }),
        });
        const json = await res.json().catch(() => null);

        if (!res.ok) {
          markFailed(tempId);
          handlers?.onError?.(json?.detail ?? json?.error ?? "Couldn’t send.");
          return;
        }

        // Remember the id so the bubble can recognize the server's copy of
        // itself and step aside, rather than both being shown.
        const gmailMessageId: string | null = json?.gmailMessageId ?? null;
        if (gmailMessageId) {
          setPending((prev) =>
            prev.map((p) =>
              p.tempId === tempId ? { ...p, gmailMessageId } : p,
            ),
          );
        }
        handlers?.onSent?.();
      } catch (err) {
        // Offline lands here: fetch rejects outright, so this is the path that
        // has to mark the bubble.
        markFailed(tempId);
        handlers?.onError?.(
          err instanceof Error ? err.message : "Couldn’t send.",
        );
      }
    },
    [markFailed],
  );

  // Retry has only the bubble's id, so it does need a lookup — but by the time
  // anyone can click retry the message has long been in state, so reading it
  // from the current render is safe here in a way it isn't for the initial
  // send.
  const retryPending = useCallback(
    async (tempId: string, handlers?: { onSent?: () => void }) => {
      const message = pending.find((p) => p.tempId === tempId);
      if (!message) return;
      await sendPending(message, handlers);
    },
    [pending, sendPending],
  );

  const pendingByThread = useMemo(() => {
    const map = new Map<string, PendingMessage[]>();
    for (const p of pending) {
      const list = map.get(p.threadId) ?? [];
      list.push(p);
      map.set(p.threadId, list);
    }
    return map;
  }, [pending]);

  const value = useMemo(
    () => ({
      pendingByThread,
      addPending,
      sendPending,
      retryPending,
      clearPending,
    }),
    [pendingByThread, addPending, sendPending, retryPending, clearPending],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePendingMessages(): PendingMessagesValue {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error(
      "usePendingMessages must be used within PendingMessagesProvider",
    );
  }
  return ctx;
}

/**
 * Append a thread's pending messages to the server's, as bubbles.
 *
 * A pending message whose Gmail id is already in the server's list is dropped
 * rather than shown twice — that's the reconciliation, and it's matched on id
 * rather than on body text so that sending the same short message twice ("ok",
 * "thanks") doesn't make the second one disappear into the first.
 */
export function mergePendingMessages(
  serverMessages: PaneMessage[],
  pending: PendingMessage[] | undefined,
): PaneMessage[] {
  if (!pending || pending.length === 0) return serverMessages;

  const serverGmailIds = new Set(
    serverMessages
      .map((m) => m.gmailMessageId)
      .filter((id): id is string => Boolean(id)),
  );

  const stillPending = pending.filter(
    (p) => !p.gmailMessageId || !serverGmailIds.has(p.gmailMessageId),
  );
  if (stillPending.length === 0) return serverMessages;

  return [
    ...serverMessages,
    ...stillPending.map(
      (p): PaneMessage => ({
        id: p.tempId,
        outgoing: true,
        body: p.body,
        fullBody: p.body,
        truncated: false,
        htmlOnly: false,
        attachments: [],
        reactions: [],
        sentAt: p.sentAt,
        // Deliberately NOT flagged as pending while in flight: a send
        // succeeds virtually every time, and marking the common case would
        // advertise the latency we're hiding rather than hide it. Only an
        // actual failure gets a treatment.
        failedToSend: p.failed ? p.tempId : undefined,
      }),
    ),
  ];
}
