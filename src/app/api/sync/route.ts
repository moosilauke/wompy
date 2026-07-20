import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAccount } from "@/lib/gmail/sync";
import {
  backfillThreadsForUser,
  rebuildThreadsForUser,
} from "@/lib/email/threading";
import { classifyUserMail } from "@/lib/email/classify-run";
import { isSupabaseConfigured } from "@/lib/env";
import type { EmailAccount } from "@/lib/types";

/**
 * Manually trigger a raw sync for every inbox connected by the current user.
 * Dispatches per provider — only Gmail is implemented; other providers are
 * skipped cleanly (their sync arrives in a later session). Manual trigger is
 * enough to validate the data flow; an interval poller is a later refinement.
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createClient();
  // getClaims() verifies the JWT locally against cached JWKS rather than
  // round-tripping to the auth server (~120ms). This route runs on every poll,
  // so that cost recurred every two minutes.
  const { data: claims } = await supabase.auth.getClaims();
  // `sub` is the JWT subject claim: the user id.
  const userId = claims?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Read the user's connected accounts (with tokens) via the admin client.
  const admin = createAdminClient();
  const { data: accounts, error } = await admin
    .from("email_accounts")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: "load_accounts_failed" }, { status: 500 });
  }
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ error: "no_accounts" }, { status: 400 });
  }

  const results = [];
  for (const account of accounts as EmailAccount[]) {
    if (account.provider !== "gmail") {
      results.push({ email: account.email, skipped: account.provider });
      continue;
    }
    try {
      const result = await syncAccount(account);
      results.push({ email: account.email, ...result });
    } catch (err) {
      results.push({
        email: account.email,
        error: err instanceof Error ? err.message : "sync_failed",
      });
    }
  }

  // Heal any messages that predate threading (or whose grouping failed midway).
  // Idempotent and cheap — it only looks at rows with a null thread_id.
  //
  // `rebuild=1` forces a full re-derivation, needed after the keying logic
  // changes (e.g. Gmail alias normalization, which retroactively excludes the
  // user's own dotted address from participant sets).
  const forceRebuild =
    new URL(request.url).searchParams.get("rebuild") === "1";

  let backfill = null;
  try {
    backfill = forceRebuild
      ? await rebuildThreadsForUser(userId)
      : await backfillThreadsForUser(userId);
  } catch (err) {
    backfill = {
      error: err instanceof Error ? err.message : "backfill_failed",
    };
  }

  // Classify senders into Contact/Company and derive each thread's tab. Runs
  // after threading so every contact row exists; respects manual overrides.
  let classification = null;
  try {
    classification = await classifyUserMail(userId);
  } catch (err) {
    classification = {
      error: err instanceof Error ? err.message : "classify_failed",
    };
  }

  return NextResponse.json({ results, backfill, classification });
}
