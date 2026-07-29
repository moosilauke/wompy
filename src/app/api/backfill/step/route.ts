import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { backfillAccount, type BackfillJobRow } from "@/lib/gmail/backfill";
import { GmailReauthRequiredError } from "@/lib/gmail/auth";
import { classifyUserMail } from "@/lib/email/classify-run";
import { isSupabaseConfigured } from "@/lib/env";
import type { EmailAccount } from "@/lib/types";

/**
 * Process one chunk of historical-sync backfill for the current user.
 *
 * Client-driven, not server-driven: there's no job queue or background
 * function in this codebase, so the client (BackfillProgress) calls this
 * repeatedly — every ~1-2s while a job is pending/running — until every
 * account's job reports `complete`. Each call does a small, bounded amount of
 * work (one Gmail list page, see backfill.ts) so it comfortably fits inside a
 * normal serverless request instead of needing a long-running process.
 *
 * Processes ONE account's job per call (the oldest not-yet-complete one, by
 * `updated_at`) rather than every account at once — keeps each call's latency
 * predictable regardless of how many mailboxes a user has connected.
 */
export async function POST() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: jobs, error: jobsError } = await admin
    .from("backfill_jobs")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["pending", "running"])
    .order("updated_at", { ascending: true })
    .limit(1);
  if (jobsError) {
    return NextResponse.json({ error: "load_jobs_failed" }, { status: 500 });
  }

  const job = (jobs ?? [])[0] as BackfillJobRow | undefined;
  if (!job) {
    // Nothing left to do — every connected account is either complete or has
    // no job at all (e.g. never connected via a path that seeds one).
    return NextResponse.json({ done: true, jobs: [] });
  }

  const { data: account, error: accountError } = await admin
    .from("email_accounts")
    .select("*")
    .eq("id", job.email_account_id)
    .single();
  if (accountError || !account) {
    return NextResponse.json({ error: "load_account_failed" }, { status: 500 });
  }

  try {
    const result = await backfillAccount(account as EmailAccount, job);

    // Scoped to exactly what this chunk touched — same reasoning as
    // /api/sync/route.ts. A chunk runs every ~1-2s while backfill is active,
    // far more often than the 2-minute poll; an unscoped full-mailbox
    // classify on that cadence would reintroduce the exact cost Phase 1
    // eliminated, just at higher frequency.
    let classification = null;
    if (result.fetchedThisStep > 0) {
      try {
        classification = await classifyUserMail(userId, {
          contactAddresses: result.threading.contactAddresses,
          threadIds: result.threading.threadIds,
        });
      } catch (err) {
        classification = {
          error: err instanceof Error ? err.message : "classify_failed",
        };
      }
    }

    return NextResponse.json({
      done: false,
      email: (account as EmailAccount).email,
      ...result,
      classification,
    });
  } catch (err) {
    if (err instanceof GmailReauthRequiredError) {
      return NextResponse.json(
        { error: err.message, reauthRequired: true },
        { status: 200 },
      );
    }
    // Logged server-side, not just returned to the client: this route is
    // called every ~1-2s during an active backfill, and a bare "something
    // failed" string with nothing in the server log makes any real bug here
    // unnecessarily hard to track down.
    console.error("backfill_step_failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "backfill_step_failed" },
      { status: 500 },
    );
  }
}
