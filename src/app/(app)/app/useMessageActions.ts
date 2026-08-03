"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToasts } from "./Toasts";
import { useOptimisticReactions } from "./OptimisticReactions";
import { useRailMutations } from "./RailMutations";
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
  const { removeThreads, patchThreads, restoreThreads } = useRailMutations();

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

  /** Trash one or more conversations, or specific messages, with an Undo toast. */
  const trash = useCallback(
    async (
      target: { threadId?: string; threadIds?: string[]; messageIds?: string[] },
      description: string,
    ) => {
      // Only a whole-thread trash removes the rail row — trashing a
      // specific message (messageIds, no threadId(s)) can leave the rest of
      // the conversation intact, so the thread itself isn't gone.
      const trashedThreadIds =
        target.threadIds ?? (target.threadId ? [target.threadId] : []);

      // Removed up front, not after the await: deleting is the most-repeated
      // destructive action in the app, and waiting on a Gmail batchModify
      // before the row disappears was the single most visible lag. Restored
      // below if the request turns out to have failed.
      const removed = removeThreads(trashedThreadIds);

      try {
        const { messageIds } = await run({ action: "trash", ...target });
        router.refresh();

        notify(`${description} moved to Trash`, async () => {
          // Put the row back immediately — the untrash round-trip that
          // follows only has to agree with what the user already sees.
          restoreThreads(removed);
          try {
            await run({ action: "untrash", messageIds });
            router.refresh();
          } catch {
            // The row is already back on screen, which is the honest state:
            // the message is still in Gmail's Trash and the next sync will
            // reconcile whichever way it actually went.
            notify("Couldn’t undo — check Gmail’s Trash");
          }
        });
      } catch (err) {
        restoreThreads(removed);
        notify(err instanceof Error ? err.message : "Couldn’t delete");
      }
    },
    [run, router, notify, removeThreads, restoreThreads],
  );

  /**
   * Flip a conversation's read state.
   *
   * No Undo toast: the action is its own inverse and one click away in the same
   * menu, so a toast would be noise.
   */
  const setRead = useCallback(
    async (
      target: { threadId?: string; threadIds?: string[]; messageIds?: string[] },
      read: boolean,
    ) => {
      // Applied before the request, not after: a thread only reachable via
      // "Load more" is outside the server's fresh first page, so a background
      // refresh alone would never touch its row again — this is what actually
      // flips the rail's unread treatment for it (see RailMutations.tsx).
      // Doing it up front also means the bold/dot treatment changes on click
      // rather than a round-trip later.
      const affectedThreadIds =
        target.threadIds ?? (target.threadId ? [target.threadId] : []);
      patchThreads(affectedThreadIds, { unread: !read });

      try {
        await run({ action: read ? "read" : "unread", ...target });
        router.refresh();
      } catch (err) {
        // Put the treatment back the way it was — the server never agreed.
        patchThreads(affectedThreadIds, { unread: read });
        notify(
          err instanceof Error
            ? err.message
            : `Couldn’t mark ${read ? "read" : "unread"}`,
        );
      }
    },
    [run, router, notify, patchThreads],
  );

  /**
   * Move one or more conversations to another tab.
   *
   * The toast confirms it rather than offering undo: the change is recorded
   * against the sender and persists across syncs, so "undo" would mean a second
   * override rather than a revert. Moving it back is the same two clicks.
   */
  const reclassify = useCallback(
    async (
      target: { threadId: string } | { threadIds: string[] },
      tab: ContactTab,
      description: string,
    ) => {
      // Removed from every tab's rail immediately — reclassify can also move
      // OTHER threads sharing the same contact (see reclassifyThreads), not
      // just the one(s) explicitly targeted, so a background refresh alone
      // could leave a now-stale row sitting in its old tab. The correct set
      // (including the newly-moved thread(s), in their new tab) comes back in
      // via the fresh payload the router.refresh() below triggers.
      const movedThreadIds =
        "threadIds" in target ? target.threadIds : [target.threadId];
      const removed = removeThreads(movedThreadIds);

      try {
        await run({ action: "reclassify", ...target, tab });
        router.refresh();
        notify(`${description} moved to ${TAB_LABELS[tab]}`);
      } catch (err) {
        restoreThreads(removed);
        notify(err instanceof Error ? err.message : "Couldn’t move it");
      }
    },
    [run, router, notify, removeThreads, restoreThreads],
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
