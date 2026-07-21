export interface ReactionSummary {
  emoji: string;
  count: number;
  /** Who reacted, for the tooltip. */
  people: string[];
}

/**
 * Reactions on a message, shown as small badges below the bubble.
 *
 * Outside the bubble rather than inside it: a reaction is a response TO the
 * message, not part of what was said, and putting it inside would imply the
 * sender wrote it.
 *
 * Identical emoji collapse into one badge with a count, so five thumbs-up read
 * as "👍 5" rather than five separate badges.
 */
export function ReactionBadges({
  reactions,
  outgoing = false,
}: {
  reactions: ReactionSummary[];
  outgoing?: boolean;
}) {
  if (reactions.length === 0) return null;

  return (
    <span
      className={`flex flex-wrap gap-1 ${outgoing ? "justify-end" : "justify-start"}`}
    >
      {reactions.map((r) => (
        <span
          key={r.emoji}
          title={`${r.people.join(", ")} reacted with ${r.emoji}`}
          className="inline-flex items-center gap-1 rounded-full border border-black/[0.07] bg-white px-2 py-[3px] text-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
        >
          <span aria-hidden>{r.emoji}</span>
          {r.count > 1 && (
            <span className="text-[11px] font-bold text-text-muted">
              {r.count}
            </span>
          )}
          <span className="sr-only">
            {r.people.join(", ")} reacted with {r.emoji}
          </span>
        </span>
      ))}
    </span>
  );
}
