/**
 * The wompy logo mark and wordmark.
 *
 * Mint is reserved for this and small accent chips — it is never a CTA colour,
 * which is coral's job.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <div className="flex items-center gap-[9px]">
      <span
        aria-hidden
        className="inline-block shrink-0 rounded-[9px] bg-mint"
        style={{ width: size, height: size }}
      />
      <span className="font-display text-[19px] font-bold lowercase tracking-[-0.5px] text-white">
        wompy
      </span>
    </div>
  );
}
