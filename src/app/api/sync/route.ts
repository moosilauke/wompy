import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAccount } from "@/lib/gmail/sync";
import { isSupabaseConfigured } from "@/lib/env";
import type { EmailAccount } from "@/lib/types";

/**
 * Manually trigger a raw sync for every inbox connected by the current user.
 * Dispatches per provider — only Gmail is implemented; other providers are
 * skipped cleanly (their sync arrives in a later session). Manual trigger is
 * enough to validate the data flow; an interval poller is a later refinement.
 */
export async function POST() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Read the user's connected accounts (with tokens) via the admin client.
  const admin = createAdminClient();
  const { data: accounts, error } = await admin
    .from("email_accounts")
    .select("*")
    .eq("user_id", user.id);

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

  return NextResponse.json({ results });
}
