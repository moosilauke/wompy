"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const STEP_INTERVAL_MS = 1500;

/**
 * Drives historical-sync backfill by calling POST /api/backfill/step
 * repeatedly while any connected account still has a pending/running job.
 *
 * Deliberately a much tighter loop than SyncPoller's 2-minute interval: this
 * is an active, user-visible import the user is waiting on, not a passive
 * background check. There's no job queue or background-function
 * infrastructure in this codebase (see HISTORICAL_SYNC_PLAN.md) — the client
 * driving repeated small steps IS the execution model, not a stand-in for a
 * "real" one.
 *
 * Stops polling entirely once the server reports `done: true` (every
 * account's job is complete or none exist) — this hook then has nothing left
 * to do for the rest of the session, so it doesn't need to re-check later.
 */
function useBackfillProgress() {
  const router = useRouter();
  const inFlight = useRef(false);
  const [active, setActive] = useState(true);
  const [messagesDone, setMessagesDone] = useState<number | null>(null);
  const [messagesEstimated, setMessagesEstimated] = useState<number | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);

  const runStep = useCallback(async () => {
    if (inFlight.current) return;
    if (typeof document !== "undefined" && document.hidden) return;

    inFlight.current = true;
    try {
      const res = await fetch("/api/backfill/step", { method: "POST" });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body?.error ?? `backfill failed (${res.status})`);
        return;
      }

      if (body?.reauthRequired) {
        setNeedsReauth(true);
        return;
      }

      if (body?.done) {
        // Nothing left for any account — stop polling for the rest of the
        // session rather than continuing to hit an endpoint with no work.
        setActive(false);
        return;
      }

      setError(null);
      setMessagesDone(body.messagesDone ?? null);
      setMessagesEstimated(body.messagesEstimated ?? null);

      // New mail appears in the rail as it's imported, same as SyncPoller —
      // this is what makes the inbox visibly fill in during backfill rather
      // than staying blank until everything finishes.
      if ((body.fetchedThisStep ?? 0) > 0) {
        router.refresh();
      }

      if (body.status === "complete") {
        setActive(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "backfill failed");
    } finally {
      inFlight.current = false;
    }
  }, [router]);

  useEffect(() => {
    if (!active) return;
    // Fire (almost) immediately on mount rather than waiting a full interval
    // for the first step — this is exactly the "seconds, not minutes" first
    // impression historical sync exists to provide. Scheduled via setTimeout
    // rather than called directly, so the effect body itself only ever
    // schedules work on external timers, matching setInterval below.
    const immediate = setTimeout(runStep, 0);
    const id = setInterval(runStep, STEP_INTERVAL_MS);
    return () => {
      clearTimeout(immediate);
      clearInterval(id);
    };
  }, [active, runStep]);

  return { active, messagesDone, messagesEstimated, error, needsReauth };
}

/**
 * Progress banner, shown only while backfill is actually running.
 *
 * Consistent with SyncStatus's "quiet unless something needs attention"
 * philosophy elsewhere in the bar — except here, an active initial import
 * IS the thing to surface, not hide, per the explicit requirement that
 * backfill progress be visible. Unmounts itself (via the hook's `active`
 * flag) the moment there's nothing left to report, so it never lingers at
 * "100%" or shows up for an account that was never mid-backfill.
 */
export function BackfillProgress() {
  const { active, messagesDone, messagesEstimated, error, needsReauth } =
    useBackfillProgress();

  if (!active) return null;

  if (needsReauth) {
    return (
      <a
        href="/api/auth/gmail/start"
        className="rounded-full bg-coral px-[14px] py-[7px] text-[13px] font-bold text-white transition-opacity hover:opacity-90"
      >
        Reconnect Gmail
      </a>
    );
  }

  if (error) {
    return (
      <span className="text-[13px] font-bold text-coral" title={error}>
        import error
      </span>
    );
  }

  // Gmail's resultSizeEstimate (captured once, from the first chunk — see
  // backfill.ts) is a rough approximation, not a real count, and can turn out
  // lower than the actual total. Once real progress passes it, showing "of
  // ~N" reads as broken rather than approximate, so the comparison is
  // dropped in favor of just the running count.
  const label =
    messagesDone === null
      ? "Importing your mail…"
      : messagesEstimated && messagesDone <= messagesEstimated
        ? `Importing your mail… (${messagesDone.toLocaleString()} of ~${messagesEstimated.toLocaleString()})`
        : `Importing your mail… (${messagesDone.toLocaleString()})`;

  return (
    <span className="text-[13px] font-bold text-on-spruce-muted">
      {label}
    </span>
  );
}
