"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToasts } from "./Toasts";

/**
 * Client helper for running message actions with toast + undo.
 *
 * Keeps the call/notify/undo/refresh sequence in one place so each new action
 * added to a context menu is a few lines rather than a repeated dance.
 */
export function useMessageActions() {
  const router = useRouter();
  const { notify } = useToasts();

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

  return { trash };
}
