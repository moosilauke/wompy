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
 */
export function SyncPoller() {
  const router = useRouter();
  const inFlight = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const runSync = useCallback(async () => {
    if (inFlight.current) return;
    if (typeof document !== "undefined" && document.hidden) return;

    inFlight.current = true;
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLastError(body?.error ?? `sync failed (${res.status})`);
      } else {
        setLastError(null);
        router.refresh();
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

  return (
    <div className="flex items-center gap-3 text-[13px]">
      {lastError && (
        <span className="font-bold text-coral" title={lastError}>
          sync error
        </span>
      )}
      {/* Secondary action — coral is reserved for the primary button. */}
      <button
        type="button"
        onClick={runSync}
        disabled={syncing}
        className="rounded-full bg-spruce-raised px-[14px] py-[7px] font-bold text-on-spruce-muted transition-colors hover:text-white disabled:opacity-50"
      >
        {syncing ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
