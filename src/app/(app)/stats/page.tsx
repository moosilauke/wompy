import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { currentUserIsAdmin } from "@/lib/admin/guard";
import { fallbackLabel } from "@/lib/email/addresses";
import { PageShell } from "@/components/chrome/PageShell";
import { StatCard } from "./StatCard";
import { PeakHourCard } from "./PeakHourCard";
import type { StatsSummary } from "./stats-types";

/**
 * Stats: fun, shareable numbers about a user's own mail — a first-class
 * "more than a Gmail clone" feature, not a settings page. Everything here
 * comes from one RPC (`stats_summary`, migration 0031) computed in a single
 * pass server-side, so this page costs one query, not several.
 *
 * Rendered server-side with UTC as the peak-send-hour timezone (a Server
 * Component has no access to the browser's own timezone) — PeakHourCard
 * quietly re-fetches client-side with the real one and swaps it in via
 * normal React state, see that file for why.
 */
export const dynamic = "force-dynamic";

export default async function StatsPage() {
  if (!isSupabaseConfigured) redirect("/login");

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims;
  if (!user) redirect("/login");
  const userEmail = typeof user.email === "string" ? user.email : null;

  const [isAdmin, { data: statsRow, error: statsError }, { data: jobRows }] =
    await Promise.all([
      currentUserIsAdmin(),
      supabase.rpc("stats_summary").maybeSingle(),
      supabase.from("backfill_jobs").select("range_after"),
    ]);

  if (statsError) {
    console.error("stats_summary failed:", statsError);
  }

  const stats = (statsRow ?? null) as StatsSummary | null;

  // How far back mail has actually been synced — the real caveat for a stats
  // page, since "longest conversation" or "longest-running relationship"
  // could be missing an even older exchange that hasn't been backfilled yet.
  // The earliest range_after across every account's backfill job, since
  // that's the true oldest boundary of what stats_summary can see.
  const syncedBackTo =
    ((jobRows ?? []) as { range_after: string }[])
      .map((j) => j.range_after)
      .sort()
      .at(0) ?? null;

  return (
    <PageShell
      userEmail={userEmail}
      isAdmin={isAdmin}
      back={{ href: "/app", label: "Back to app" }}
    >
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-8 font-display text-2xl font-bold text-text-body">
          Your stats
        </h1>

        {!stats || stats.total_messages === 0 ? (
          <div className="rounded-[14px] border border-dashed border-black/[0.12] bg-white/60 px-6 py-10 text-center">
            <p className="text-[14px] font-bold text-text-body">
              Not enough mail yet
            </p>
            <p className="mt-1 text-[13px] text-text-muted-2">
              Once you&rsquo;ve sent and received a bit more, your stats will
              show up here.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 rounded-[14px] border border-black/[0.06] bg-white px-6 py-7 text-center">
              <p className="font-display text-5xl font-bold text-text-body">
                {stats.total_messages.toLocaleString()}
              </p>
              <p className="mt-1 text-[13.5px] font-bold text-text-muted">
                messages across {stats.total_conversations.toLocaleString()}{" "}
                conversations
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                accent="avatar-blue"
                icon="🏆"
                label="Busiest contact"
                value={
                  stats.busiest_contact_address
                    ? stats.busiest_contact_name ??
                      fallbackLabel(stats.busiest_contact_address)
                    : null
                }
                detail={
                  stats.busiest_contact_address
                    ? `${stats.busiest_contact_count?.toLocaleString()} messages exchanged`
                    : null
                }
                empty="No standout contact yet"
              />

              <StatCard
                accent="avatar-sage"
                icon="💬"
                label="Longest conversation"
                value={
                  stats.longest_thread_partner
                    ? stats.longest_thread_partner_name ??
                      fallbackLabel(stats.longest_thread_partner)
                    : null
                }
                detail={
                  stats.longest_thread_span_days
                    ? `Spanning ${formatSpan(stats.longest_thread_span_days)}`
                    : null
                }
                empty="No long-running conversation yet"
              />

              <StatCard
                accent="avatar-terracotta"
                icon="⚡"
                label="Fastest reply"
                value={
                  stats.fastest_reply_seconds !== null
                    ? formatDuration(stats.fastest_reply_seconds)
                    : null
                }
                detail={
                  stats.fastest_reply_partner
                    ? `Replying to ${
                        stats.fastest_reply_partner_name ??
                        fallbackLabel(stats.fastest_reply_partner)
                      }`
                    : null
                }
                empty="No matched reply yet"
              />

              <PeakHourCard
                initialHour={stats.peak_send_hour}
                initialCount={stats.peak_send_hour_count}
              />

              <StatCard
                accent="avatar-olive"
                icon="🌱"
                label="Longest-running relationship"
                value={
                  stats.oldest_ongoing_partner
                    ? stats.oldest_ongoing_partner_name ??
                      fallbackLabel(stats.oldest_ongoing_partner)
                    : null
                }
                detail={
                  stats.oldest_ongoing_started_at
                    ? `Talking since ${new Date(
                        stats.oldest_ongoing_started_at,
                      ).getFullYear()}, still going`
                    : null
                }
                empty="No long-running relationship yet"
              />

              <StatCard
                accent="coral"
                icon="🎉"
                label="Reactions"
                value={`${stats.reactions_given} given · ${stats.reactions_received} received`}
                detail={null}
                empty={null}
              />
            </div>
          </>
        )}

        <p className="mt-8 text-center text-[12px] text-text-muted-3">
          {syncedBackTo
            ? `Based on mail synced back to ${formatDate(syncedBackTo)}`
            : "Based on your synced mail"}
          ; sync more in Settings if needed. Nothing here leaves your
          account or is visible to others.
        </p>
      </div>
    </PageShell>
  );
}

/** "8/7/24" — matches lastSyncedLabel's date format elsewhere in this app. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

/** "56 seconds", "3 minutes", "2 hours", "4 days" — whichever unit is most legible. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  return `${Math.round(days)}d`;
}

/** "2 years", "8 months", "3 days" — the widest legible unit for a thread's span. */
function formatSpan(days: number): string {
  if (days >= 365) return `${(days / 365).toFixed(1)} years`;
  if (days >= 30) return `${Math.round(days / 30)} months`;
  return `${Math.round(days)} days`;
}
