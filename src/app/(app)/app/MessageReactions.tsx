"use client";

import { useEffect } from "react";
import {
  ReactionBadges,
  type ReactionSummary,
} from "@/components/ui/ReactionBadges";
import {
  mergeReactions,
  useOptimisticReactions,
} from "./OptimisticReactions";

/**
 * A message's reaction badges, merged with any the user just added.
 *
 * Server-rendered reactions come in as props; a reaction the user added this
 * session appears here the instant they click, before the round-trip finishes,
 * and is deduplicated once the refreshed props catch up.
 */
export function MessageReactions({
  messageId,
  reactions,
}: {
  messageId: string;
  reactions: ReactionSummary[];
}) {
  const { pendingByMessage, clearPending } = useOptimisticReactions();
  const pending = pendingByMessage.get(messageId);

  // Once the refreshed props include a pending emoji, retire the optimistic
  // copy so it isn't tracked indefinitely. In an effect, not during render.
  useEffect(() => {
    if (!pending) return;
    const serverEmoji = new Set(reactions.map((r) => r.emoji));
    for (const emoji of pending) {
      if (serverEmoji.has(emoji)) clearPending(messageId, emoji);
    }
  }, [pending, reactions, messageId, clearPending]);

  const merged = mergeReactions(reactions, pending);
  if (merged.length === 0) return null;

  return <ReactionBadges reactions={merged} />;
}
