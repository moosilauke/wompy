"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToasts } from "./Toasts";
import { useOptimisticReactions } from "./OptimisticReactions";
import type { ContactTab } from "@/lib/types";

/**
 * Client helper for running message actions with toast + undo.
 *
 * Keeps the call/notify/undo/refresh sequence in one place so each new action
 * added to a context menu is a few lines rather than a repeated dance.
 */
export function useMessageActions() {
  const router = useRouter();
  const { notify } = useToasts();
  const { addPending, clearPending } = useOptimisticReactions();

  const run = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.detail ?? json?.error ?? "Action failed");
      }
      return json as { messageIds: string[] };
    },
    [],
  );

  /** Trash a whole conversation or specific messages, with an Undo toast. */
  const trash = useCallback(
    async (
      target: { threadId?: string; messageIds?: string[] },
      description: string,
    ) => {
      try {
        const { messageIds } = await run({ action: "trash", ...target });
        router.refresh();

        notify(`${description} moved to Trash`, async () => {
          try {
            await run({ action: "untrash", messageIds });
            router.refresh();
          } catch {
            notify("Couldn’t undo — check Gmail’s Trash");
          }
        });
      } catch (err) {
        notify(err instanceof Error ? err.message : "Couldn’t delete");
      }
    },
    [run, router, notify],
  );

  /**
   * Flip a conversation's read state.
   *
   * No Undo toast: the action is its own inverse and one click away in the same
   * menu, so a toast would be noise.
   */
  const setRead = useCallback(
    async (target: { threadId?: string; messageIds?: string[] }, read: boolean) => {
      try {
        await run({ action: read ? "read" : "unread", ...target });
        router.refresh();
      } catch (err) {
        notify(
          err instanceof Error
            ? err.message
            : `Couldn’t mark ${read ? "read" : "unread"}`,
        );
      }
    },
    [run, router, notify],
  );

  /**
   * Move a conversation to another tab.
   *
   * The toast confirms it rather than offering undo: the change is recorded
   * against the sender and persists across syncs, so "undo" would mean a second
   * override rather than a revert. Moving it back is the same two clicks.
   */
  const reclassify = useCallback(
    async (threadId: string, tab: ContactTab, description: string) => {
      try {
        await run({ action: "reclassify", threadId, tab });
        router.refresh();
        notify(`${description} moved to ${TAB_LABELS[tab]}`);
      } catch (err) {
        notify(err instanceof Error ? err.message : "Couldn’t move it");
      }
    },
    [run, router, notify],
  );

  /**
   * React to a message with an emoji.
   *
   * The badge is shown immediately via the optimistic layer, then reconciled
   * against the server's refreshed data. On failure the optimistic badge is
   * pulled back and the error surfaced, so a rejected reaction (e.g. a recipient
   * whose client won't render it) doesn't linger as if it succeeded.
   */
  const react = useCallback(
    async (messageId: string, emoji: string) => {
      addPending(messageId, emoji);
      try {
        const res = await fetch("/api/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId, emoji }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json?.detail ?? json?.error ?? "Couldn’t react");
        }
        // The server now has it; refresh so the real badge replaces the
        // optimistic one. The pending entry is cleared once props reflect it.
        router.refresh();
      } catch (err) {
        clearPending(messageId, emoji);
        notify(err instanceof Error ? err.message : "Couldn’t react");
      }
    },
    [router, notify, addPending, clearPending],
  );

  return { trash, setRead, reclassify, react };
}

const TAB_LABELS: Record<ContactTab, string> = {
  contact: "Contacts",
  company: "Companies",
  spam: "Spam",
};
