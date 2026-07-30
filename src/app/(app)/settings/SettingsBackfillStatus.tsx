"use client";

import { useBackfillProgress } from "../app/BackfillProgress";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { extendBackfillRange } from "../actions";
import type { BackfillJobSummary } from "./page";

const POLL_INTERVAL_MS = 4000;

/** "Jul 2025" — just enough precision to convey how far back a backfill
 * reaches; a full timestamp would be more detail than this needs. */
function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

/**
 * Per-account backfill status in Settings: a progress bar while
 * pending/running, or "Synced back to <date>" + a "Go back further" control
 * once complete.
 *
 * Polls independently of the top bar's BackfillProgress, on a slower
 * interval (Settings is a page glanced at, not stared at) and scoped to this
 * specific account via useBackfillProgress's accountId param — without that
 * scoping, this component and any sibling rows (a user with 2+ connected
 * mailboxes) would all poll the same global "oldest job" endpoint and could
 * misattribute another account's progress to this row.
 */
export function SettingsBackfillStatus({
  accountId,
  initialJob,
}: {
  accountId: string;
  initialJob: BackfillJobSummary;
}) {
  const { messagesDone, error, needsReauth } = useBackfillProgress(
    POLL_INTERVAL_MS,
    accountId,
  );

  // Live values only ever move this account's own state forward — seed from
  // the server's initial snapshot so there's no flash of "no progress yet"
  // before the first client poll lands.
  const done = messagesDone ?? initialJob.messagesDone;
  const isActive =
    initialJob.status === "pending" || initialJob.status === "running";

  if (needsReauth) {
    return (
      <a
        href="/api/auth/gmail/start"
        className="mt-2 inline-block rounded-full bg-coral px-3.5 py-1.5 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90"
      >
        Reconnect to resume import
      </a>
    );
  }

  if (error) {
    return (
      <p className="mt-2 text-[12.5px] text-coral" title={error}>
        Import paused — it will retry automatically.
      </p>
    );
  }

  if (isActive) {
    return (
      <div className="mt-2.5 flex flex-col gap-1.5">
        <ProgressBar />
        <p className="text-[12.5px] text-text-muted-2">
          Importing history — {done.toLocaleString()} so far
        </p>
      </div>
    );
  }

  // Complete: show what's actually been imported, plus the option to widen
  // the range. Reuses the same backfill_jobs row (see migration 0020's own
  // anticipated design) rather than creating a second job per account.
  //
  // The control expands inline (pushing the row taller) rather than floating
  // as an absolutely-positioned popover — the mailboxes list's card wrapper
  // has overflow-hidden (to keep its rounded corners clean against the row
  // dividers), which clips anything absolutely positioned inside a row. One
  // <details> wrapping both the summary and the form avoids that entirely,
  // with no JS needed to keep two separate toggles in sync.
  return (
    <details className="mt-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <p className="text-[12.5px] text-text-muted-2">
          Synced back to {monthYear(initialJob.rangeAfter)}
        </p>
        <span className="text-[12.5px] font-bold text-spruce hover:underline">
          Go back further
        </span>
      </summary>
      <form
        action={extendBackfillRange}
        className="mt-2 flex items-center gap-2"
      >
        <input type="hidden" name="accountId" value={accountId} />
        <select
          name="months"
          defaultValue="12"
          className="rounded-[10px] border border-black/10 px-2.5 py-1.5 text-[13px] text-text-body outline-none focus:border-mint"
        >
          <option value="12">1 more year</option>
          <option value="60">5 more years</option>
          <option value="9999">All mail</option>
        </select>
        <button
          type="submit"
          className="shrink-0 rounded-full bg-coral px-3.5 py-1.5 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90"
        >
          Go
        </button>
      </form>
    </details>
  );
}
