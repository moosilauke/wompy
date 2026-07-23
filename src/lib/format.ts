/** Display formatting helpers for the chat UI. */

/** Compact relative timestamp for the contact rail ("14:32", "Tue", "12 Mar"). */
export function railTimestamp(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();

  if (isSameDay(date, now)) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((now.getTime() - date.getTime()) / dayMs);
  if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }

  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Day-divider label above a group of bubbles ("TODAY", "YESTERDAY", a date). */
export function dayDividerLabel(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();

  if (isSameDay(date, now)) return "TODAY";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return "YESTERDAY";

  return date
    .toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    })
    .toUpperCase();
}

/** Clock time inside a message bubble. */
export function bubbleTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Human-readable "last synced" line for the Sync now tooltip, in the viewer's
 * local timezone — e.g. "Last synced 12:29pm on 7/23/26". Lowercase am/pm and a
 * no-leading-zero M/D/YY date, matching the intended copy. Returns a fallback
 * when nothing has synced yet.
 */
export function lastSyncedLabel(iso: string | null): string {
  if (!iso) return "Not synced yet";
  const d = new Date(iso);

  const time = d
    .toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    // "12:29 PM" → "12:29pm"
    .replace(/\s?([AP])M$/i, (_, p: string) => p.toLowerCase() + "m");

  const date = `${d.getMonth() + 1}/${d.getDate()}/${String(
    d.getFullYear(),
  ).slice(-2)}`;

  return `Last synced ${time} on ${date}`;
}

/** Calendar-day key, used to decide where day dividers go. */
export function dayKey(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
