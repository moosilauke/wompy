"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Client-side buttons for the debug view: connect Gmail, run a sync, sign out.
 * Deliberately utilitarian — this whole page is throwaway scaffolding. */
export function DebugActions({ signOutAction }: { signOutAction: () => void }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  async function runSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = await res.json();
      setSyncResult(JSON.stringify(json, null, 2));
      router.refresh();
    } catch (err) {
      setSyncResult(err instanceof Error ? err.message : "sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <a
          href="/app"
          className="rounded-[100px] bg-spruce px-4 py-2 font-bold text-white"
        >
          Open Wompy
        </a>
        <a
          href="/api/auth/gmail/start"
          className="rounded-[100px] bg-mint px-4 py-2 font-bold text-spruce"
        >
          Connect Gmail
        </a>
        <button
          type="button"
          disabled
          title="Yahoo support is coming soon"
          className="cursor-not-allowed rounded-[100px] border border-black/15 px-4 py-2 font-bold text-text-muted-2 opacity-60"
        >
          Connect Yahoo (soon)
        </button>
        <button
          onClick={runSync}
          disabled={syncing}
          className="rounded-[100px] bg-coral px-4 py-2 font-bold text-white disabled:opacity-60"
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <button
          onClick={() => signOutAction()}
          className="rounded-[100px] border border-black/15 px-4 py-2 font-bold text-text-body"
        >
          Sign out
        </button>
      </div>

      {syncResult && (
        <pre className="max-h-64 overflow-auto rounded-[14px] bg-white p-3 text-xs shadow-[0_2px_8px_rgba(0,0,0,0.05)]">
          {syncResult}
        </pre>
      )}
    </div>
  );
}
