/** Accent border classes, matching Avatar.tsx's static-class-map pattern
 * (Tailwind can't see a class name built from a template string, so each
 * variant needs to appear literally somewhere in the source). */
const ACCENT_CLASSES = {
  "avatar-blue": "border-t-avatar-blue",
  "avatar-sage": "border-t-avatar-sage",
  "avatar-olive": "border-t-avatar-olive",
  "avatar-sand": "border-t-avatar-sand",
  "avatar-terracotta": "border-t-avatar-terracotta",
  coral: "border-t-coral",
} as const;

/**
 * One stat tile. Legible as a standalone screenshot crop — label, big value,
 * one-line human sentence — since this page is meant to be shared, not just
 * viewed in place. `accent` picks one of the app's existing avatar hues (or
 * coral, already "badges" per globals.css) as a thin top border rather than
 * introducing new colors for this one page.
 */
export function StatCard({
  accent,
  icon,
  label,
  value,
  detail,
  empty,
  id,
}: {
  accent: keyof typeof ACCENT_CLASSES;
  /** A single emoji. No icon library exists in this app yet (it's its own
   * unstarted roadmap item) — an emoji is a zero-dependency stopgap that
   * suits this page's fun/shareable tone, meant to be swapped for a real
   * icon set once that lands app-wide. */
  icon: string;
  label: string;
  value: string | null;
  detail: string | null;
  /** Shown instead of value/detail when there's not yet enough data. */
  empty: string | null;
  id?: string;
}) {
  const hasValue = value !== null;

  return (
    <div
      id={id}
      className={`rounded-[14px] border-t-[3px] bg-white px-5 py-4 ${
        hasValue
          ? `border-black/[0.06] ${ACCENT_CLASSES[accent]}`
          : "border-dashed border-black/[0.1] border-t-black/[0.1]"
      }`}
    >
      <p className="text-[12px] font-extrabold uppercase tracking-[0.4px] text-text-muted-2">
        <span aria-hidden className="mr-1.5">
          {icon}
        </span>
        {label}
      </p>
      {hasValue ? (
        <>
          <p className="mt-1.5 truncate font-display text-xl font-bold text-text-body">
            {value}
          </p>
          {detail && (
            <p className="mt-0.5 text-[12.5px] text-text-muted-2">{detail}</p>
          )}
        </>
      ) : (
        <p className="mt-1.5 text-[13px] text-text-muted-3">{empty}</p>
      )}
    </div>
  );
}
