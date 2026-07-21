import { Avatar } from "./Avatar";

/**
 * One row in the contact rail — avatar, name, timestamp, snippet, unread dot.
 *
 * Presentational only. The app wraps this in a Link (navigation) and a
 * ThreadRowMenu (delete, mark read); the landing page renders it inert. Keeping
 * the row's layout here means the rail looks identical in both without the
 * landing page carrying any action code.
 */
export function RailRow({
  address,
  label,
  timestamp,
  snippet,
  unread = false,
  active = false,
  extraParticipants = 0,
}: {
  address: string;
  label: string;
  timestamp: string;
  snippet: string;
  unread?: boolean;
  active?: boolean;
  /** "+2" suffix for group conversations. */
  extraParticipants?: number;
}) {
  return (
    <span
      className={`flex items-center gap-[11px] rounded-xl p-2.5 transition-colors ${
        active
          ? "bg-[oklch(0.8_0.13_175_/_0.25)]"
          : "hover:bg-white/[0.06]"
      }`}
    >
      <Avatar address={address} label={label} size={44} />

      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-sm text-on-spruce ${
              unread ? "font-extrabold" : "font-bold"
            }`}
          >
            {label}
            {extraParticipants > 0 && (
              <span className="font-semibold text-on-spruce-muted">
                {" "}
                +{extraParticipants}
              </span>
            )}
          </span>
          <span className="shrink-0 text-xs text-on-spruce-muted">
            {timestamp}
          </span>
        </span>

        <span className="flex min-w-0 items-center justify-between gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-[12.5px] ${
              unread
                ? "font-bold text-on-spruce-bright"
                : "font-medium text-on-spruce-muted"
            }`}
          >
            {snippet}
          </span>
          {unread && (
            <span
              aria-label="Unread"
              className="h-[9px] w-[9px] shrink-0 rounded-full bg-coral"
            />
          )}
        </span>
      </span>
    </span>
  );
}
