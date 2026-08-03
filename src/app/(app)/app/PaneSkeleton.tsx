/**
 * Placeholder bubbles shown while a conversation's messages are in flight.
 *
 * Only the bubbles are placeholders — by the time this renders, the header,
 * avatar, and composer are already showing the real conversation, painted from
 * rail data the client had before the click. So this fills the gap between
 * "which conversation" (instant) and "what's in it" (one round-trip), rather
 * than standing in for the whole pane.
 *
 * Widths alternate and vary so the shapes read as messages rather than as a
 * loading bar, and the sides alternate the way a conversation does.
 */
const SHAPES = [
  { outgoing: false, width: "w-[62%]" },
  { outgoing: true, width: "w-[45%]" },
  { outgoing: false, width: "w-[71%]" },
  { outgoing: true, width: "w-[38%]" },
];

export function PaneSkeleton() {
  return (
    <div
      className="flex flex-1 flex-col gap-3 overflow-hidden px-4 py-5 md:px-10 md:py-7"
      aria-hidden
    >
      {SHAPES.map((shape, i) => (
        <div
          key={i}
          className={`flex ${shape.outgoing ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`h-[52px] animate-pulse rounded-[18px] bg-black/[0.055] ${shape.width}`}
            // Staggered so the four don't pulse in lockstep, which reads as a
            // single block rather than as separate messages.
            style={{ animationDelay: `${i * 120}ms` }}
          />
        </div>
      ))}
    </div>
  );
}
