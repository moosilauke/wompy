"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactionSummary } from "@/components/ui/ReactionBadges";

/**
 * Optimistic reactions.
 *
 * Sending a reaction is a round-trip (send -> ingest -> refresh) that's slow
 * enough to feel like a delay. This holds reactions the user just added in
 * client state so the badge appears the instant they click, and merges them
 * with the server's reactions at render.
 *
 * A pending reaction is cleared once the server's refreshed data includes it —
 * detected by the emoji showing up in the props — or dropped on failure so a
 * rejected reaction doesn't linger. Keyed by message id.
 */

interface PendingReaction {
  messageId: string;
  emoji: string;
}

interface OptimisticReactionsValue {
  /** Reactions the user has added this session that may not be in props yet. */
  pendingByMessage: Map<string, string[]>;
  addPending: (messageId: string, emoji: string) => void;
  clearPending: (messageId: string, emoji: string) => void;
}

const Context = createContext<OptimisticReactionsValue | null>(null);

export function OptimisticReactionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pending, setPending] = useState<PendingReaction[]>([]);

  const addPending = useCallback((messageId: string, emoji: string) => {
    setPending((prev) => [...prev, { messageId, emoji }]);
  }, []);

  const clearPending = useCallback((messageId: string, emoji: string) => {
    setPending((prev) =>
      prev.filter(
        (p) => !(p.messageId === messageId && p.emoji === emoji),
      ),
    );
  }, []);

  const pendingByMessage = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of pending) {
      const list = map.get(p.messageId) ?? [];
      list.push(p.emoji);
      map.set(p.messageId, list);
    }
    return map;
  }, [pending]);

  const value = useMemo(
    () => ({ pendingByMessage, addPending, clearPending }),
    [pendingByMessage, addPending, clearPending],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOptimisticReactions(): OptimisticReactionsValue {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error(
      "useOptimisticReactions must be used within OptimisticReactionsProvider",
    );
  }
  return ctx;
}

/**
 * Merge the server's reaction summaries for a message with any the user just
 * added optimistically.
 *
 * A pending emoji already present in the server data is skipped rather than
 * double-counted — the refresh has caught up, and the provider will clear it
 * shortly. The current user is credited as the reactor for a pending one.
 */
export function mergeReactions(
  serverReactions: ReactionSummary[],
  pendingEmoji: string[] | undefined,
): ReactionSummary[] {
  if (!pendingEmoji || pendingEmoji.length === 0) return serverReactions;

  const merged = serverReactions.map((r) => ({ ...r, people: [...r.people] }));

  for (const emoji of pendingEmoji) {
    const existing = merged.find((r) => r.emoji === emoji);
    if (existing) {
      // Already reflected by the server; don't count it twice.
      if (!existing.people.includes("You")) continue;
    } else {
      merged.push({ emoji, count: 1, people: ["You"] });
    }
  }

  return merged;
}
