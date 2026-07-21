"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Background sync poller. Calls POST /api/sync on an interval while the tab is
 * visible, then refreshes server components so new mail appears on its own.
 *
 * Polling only (no Gmail push/Pub-Sub) per the MVP plan. Two guards keep it
 * well-behaved: skip while a sync is already in flight, and pause entirely when
 * the tab is hidden so a backgrounded tab doesn't keep hitting the Gmail API.
 *
 * Exposed as a hook because the manual "Sync now" control now lives in the
 * account menu while the reconnect prompt stays in the bar — the two need the
 * same state without two copies of the polling logic.
 */
export function useSyncPoller() {
  const router = useRouter();
  const inFlight = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  // Distinct from a generic error: this one the user can actually fix, and the
  // only fix is re-granting access. Mirrored into a ref so the polling callback
  // reads the current value rather than one captured when it was created.
  const [needsReauth, setNeedsReauth] = useState(false);
  const reauthRef = useRef(false);

  const runSync = useCallback(async () => {
    if (inFlight.current) return;
    if (typeof document !== "undefined" && document.hidden) return;
    // Polling a connection that needs re-consent just burns requests on a
    // guaranteed failure. The Reconnect button still works.
    if (reauthRef.current) return;

    inFlight.current = true;
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setLastError(body?.error ?? `sync failed (${res.status})`);
      } else {
        // A 200 can still carry a per-account failure: the route reports each
        // account separately so one dead connection doesn't fail the whole run.
        const reauth = (body?.results ?? []).some(
          (r: { reauthRequired?: boolean }) => r.reauthRequired,
        );
        reauthRef.current = reauth;
        setNeedsReauth(reauth);
        setLastError(null);
        if (!reauth) router.refresh();
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "sync failed");
    } finally {
      inFlight.current = false;
      setSyncing(false);
    }
  }, [router]);

  useEffect(() => {
    const id = setInterval(runSync, POLL_INTERVAL_MS);

    // Catch up as soon as the tab regains focus after being hidden.
    const onVisible = () => {
      if (!document.hidden) runSync();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [runSync]);

  return { runSync, syncing, lastError, needsReauth };
}

/**
 * Sync status shown in the bar.
 *
 * Deliberately NOT inside the account menu: a reconnect prompt is the one thing
 * the user must act on for mail to keep arriving, and burying it behind a click
 * would hide it. Renders nothing when everything is healthy, so the bar stays
 * quiet in the normal case.
 */
export function SyncStatus({
  lastError,
  needsReauth,
}: {
  lastError: string | null;
  needsReauth: boolean;
}) {
  if (needsReauth) {
    // Google's consent screen is the only fix, so link straight to it rather
    // than reporting a failure the user can't act on.
    return (
      <a
        href="/api/auth/gmail/start"
        className="rounded-full bg-coral px-[14px] py-[7px] text-[13px] font-bold text-white transition-opacity hover:opacity-90"
      >
        Reconnect Gmail
      </a>
    );
  }

  if (lastError) {
    return (
      <span className="text-[13px] font-bold text-coral" title={lastError}>
        sync error
      </span>
    );
  }

  return null;
}
