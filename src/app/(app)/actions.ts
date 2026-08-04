"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TAB_COUNT_MODES, type TabCountMode } from "@/lib/types";

/**
 * Sign the current user out and return home with the auth modal open, so
 * signing back in is one step rather than a separate page.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/?auth=1");
}

/** A fixed, early-enough date that "all mail" needs no unbounded/null special
 * case anywhere in backfillAccount()'s query shape — see HISTORICAL_SYNC_PLAN.md. */
const ALL_MAIL_SINCE = new Date("2004-01-01T00:00:00Z");

/**
 * Widen a completed backfill job's range further back in time — the
 * Settings "Go back further" control.
 *
 * Reuses the same `backfill_jobs` row rather than creating a second one per
 * account (this design was anticipated in migration 0020's own header
 * comment): the new `range_after` becomes the old `range_before`'s
 * counterpart going further back, `range_before` becomes the OLD
 * `range_after` (so the next chunk resumes exactly where the prior window
 * left off — no gap, no overlap), `page_token` resets to null, and `status`
 * returns to `pending`. The existing chunked-polling machinery (both the top
 * bar's and Settings' independent pollers) picks it up on their next tick
 * with no other code changes needed.
 */
export async function extendBackfillRange(formData: FormData) {
  const accountId = formData.get("accountId");
  const monthsRaw = formData.get("months");
  if (typeof accountId !== "string" || typeof monthsRaw !== "string") return;
  const months = Number(monthsRaw);
  if (!Number.isFinite(months) || months <= 0) return;

  // RLS-scoped read first, so a request for an account id that isn't the
  // current user's own simply finds nothing — the admin client below never
  // touches a row this check didn't already confirm ownership of.
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("email_accounts")
    .select("id")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return;

  const admin = createAdminClient();
  const { data: job } = await admin
    .from("backfill_jobs")
    .select("id, range_after")
    .eq("email_account_id", accountId)
    .maybeSingle();
  if (!job) return;

  const newRangeAfter =
    months >= 9999
      ? ALL_MAIL_SINCE
      : (() => {
          const d = new Date(job.range_after);
          d.setMonth(d.getMonth() - months);
          return d;
        })();

  await admin
    .from("backfill_jobs")
    .update({
      range_before: job.range_after,
      range_after: newRangeAfter.toISOString(),
      page_token: null,
      status: "pending",
      last_error: null,
    })
    .eq("id", job.id);

  revalidatePath("/settings");
}

/**
 * Set the Contacts/Companies/Spam tab badges' counter mode (Settings ›
 * Preferences). Written via the admin client because `profiles` has no
 * authenticated-write RLS policy — every write goes through the service role
 * so a user can never touch `is_admin` on their own row (see migration
 * 0016) — so the same route is reused here rather than opening a new policy
 * just for this one column.
 */
export async function updateTabCountMode(formData: FormData) {
  const mode = formData.get("mode");
  if (
    typeof mode !== "string" ||
    !TAB_COUNT_MODES.includes(mode as TabCountMode)
  ) {
    return;
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return;

  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ tab_count_mode: mode })
    .eq("id", userId);

  revalidatePath("/settings");
  revalidatePath("/app");
}

/**
 * Whether "View original" loads remote images without asking (Settings ›
 * Preferences).
 *
 * Off by default: a remote image's URL carries a per-recipient token, so
 * loading one tells the sender that this person opened this message at this
 * time. On means mail simply renders as designed, for people who would rather
 * have that than the privacy. It governs images ONLY — sanitization is not
 * affected by it, and must never be.
 *
 * Written via the admin client for the same reason as updateTabCountMode
 * above: `profiles` has no authenticated-write RLS policy, deliberately, so a
 * user can never touch `is_admin` on their own row (migration 0016).
 */
export async function updateAlwaysLoadImages(formData: FormData) {
  const next = formData.get("enabled") === "true";

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return;

  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ always_load_images: next })
    .eq("id", userId);

  revalidatePath("/settings");
  revalidatePath("/app");
}
