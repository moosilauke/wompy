/**
 * A chat bubble — shape only, no behavior.
 *
 * Shared between the authenticated reading pane and the landing page, which the
 * design spec defines as being the app shell rather than a marketing page that
 * resembles it. Keeping the shape here means a change to radius, fill, or shadow
 * lands in both, and the two can't drift.
 *
 * Deliberately presentational: the app wraps this in MessageBody (context menu,
 * full-message modal), the landing page renders it with plain children. A
 * visitor therefore has no path to an action — the behavior lives in the
 * wrapper, not here.
 *
 * The asymmetric radius gives each bubble a "tail" on the side it came from.
 */
export function Bubble({
  outgoing = false,
  className = "",
  children,
}: {
  /** Right-aligned and spruce-filled, i.e. sent by the current user. */
  outgoing?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${
        outgoing
          ? "rounded-[16px_16px_4px_16px] bg-spruce text-white shadow-[0_4px_12px_rgba(29,74,69,0.3)]"
          : "rounded-[4px_16px_16px_16px] border border-black/[0.06] bg-bubble-incoming text-text-body shadow-[0_2px_8px_rgba(0,0,0,0.05)]"
      } px-4 py-3 text-[15px] font-medium leading-[1.45] ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The row a bubble sits in: alignment, width cap, and the timestamp beneath.
 *
 * Separate from Bubble so the landing page can use bubbles without timestamps
 * (its pitch feed is a single burst, not a timed conversation).
 */
export function BubbleRow({
  outgoing = false,
  timestamp,
  children,
}: {
  outgoing?: boolean;
  timestamp?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex max-w-[62%] flex-col gap-1 ${
        outgoing ? "items-end self-end" : "items-start self-start"
      }`}
    >
      {children}
      {timestamp && (
        <span className="px-1 text-[11.5px] text-text-muted-3">{timestamp}</span>
      )}
    </div>
  );
}

/** Centered day-divider pill ("TODAY"). */
export function DayDivider({ label }: { label: string }) {
  return (
    <div className="self-center rounded-full bg-divider-bg px-3.5 py-[5px] text-xs font-extrabold tracking-[0.3px] text-divider-text">
      {label}
    </div>
  );
}
