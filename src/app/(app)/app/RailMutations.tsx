"use client";

import { createContext, useContext } from "react";
import type { RailThread } from "./ContactRail";

/**
 * Lets a deeply-nested action (ThreadRowMenu/ThreadSelectionMenu's mark
 * read/unread, trash, and move-to-tab) reach back up into AppShell's
 * accumulated rail state.
 *
 * Needed because of the same background-refresh fix that protects "Load
 * more" progress and an in-progress selection (see AppShell's mergeFreshRail):
 * a background router.refresh() only overlays fresh data for threads within
 * the server's bounded FIRST PAGE per tab — a thread only reachable via
 * "Load more" is, by definition, never in that fresh payload, so nothing
 * about it (read state, snippet, anything) gets updated by router.refresh()
 * alone anymore. That's the right call for a passive background poll (it has
 * no way to tell "unchanged" apart from "past the loaded window" for a row
 * it didn't send), but a manual action the user just took on a SPECIFIC
 * thread knows exactly what changed — this is how it applies that change to
 * the rail immediately, rather than waiting on a refresh that may never
 * touch that row again.
 */
interface RailMutationsValue {
  /** Remove these thread ids from every tab's accumulated rail list at once —
   * the caller already knows which ids just got trashed/moved, not which tab
   * each one lived in. */
  removeThreads: (threadIds: string[]) => void;
  /** Apply a partial update to specific thread ids, wherever they currently
   * live across tabs — e.g. flipping `unread` after a manual mark read/unread,
   * which a background refresh can no longer be relied on to do for a thread
   * outside the server's fresh first page. */
  patchThreads: (threadIds: string[], patch: Partial<RailThread>) => void;
}

const Context = createContext<RailMutationsValue | null>(null);

export const RailMutationsProvider = Context.Provider;

/** Returns a no-op when called outside AppShell (e.g. the landing page's
 * inert preview rail) rather than throwing — unlike OptimisticReactions,
 * nothing here is essential to an action succeeding, just to the rail
 * staying tidy afterward. */
export function useRailMutations(): RailMutationsValue {
  return (
    useContext(Context) ?? {
      removeThreads: () => {},
      patchThreads: () => {},
    }
  );
}
