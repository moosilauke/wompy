/**
 * Indeterminate activity bar: a fixed-width segment sweeps back and forth
 * across the track. Gmail's resultSizeEstimate (the only "total" backfill
 * ever has to work with) is a rough approximation of the query's match count,
 * not a reliable denominator — it can just as easily land too high (implying
 * false near-completion early) as too low (pinning a determinate fill at
 * 100% while the real count keeps climbing underneath it, which is what a
 * done/estimated fraction actually did in practice). Rather than chase a
 * number that can't be trusted at any point, this only ever communicates
 * "still working" — the real count is the text label next to it.
 */
export function ProgressBar({
  trackClassName = "bg-black/10",
  fillClassName = "bg-spruce",
}: {
  /** Override for the track's background — the default reads on a light
   * (cream/white) surface; pass e.g. "bg-white/25" on spruce. */
  trackClassName?: string;
  /** Override for the sweeping segment — the default (solid spruce) reads on
   * a light surface, but spruce chrome (the top bar) needs a fill that isn't
   * spruce itself, or it'd blend into the page behind it; pass e.g.
   * "bg-mint" there. */
  fillClassName?: string;
}) {
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full ${trackClassName}`}
    >
      <div
        className={`h-full w-1/3 animate-progress-sweep rounded-full ${fillClassName}`}
      />
    </div>
  );
}
