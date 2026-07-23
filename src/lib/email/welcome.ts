import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWelcomeEmail } from "@/lib/email/templates";

/**
 * Send the welcome email exactly once for a genuinely-new user.
 *
 * Idempotent via profiles.welcomed_at: the send is attempted only when that
 * column is null, and it's stamped BEFORE sending so two near-simultaneous
 * calls (e.g. a race between paths) can't both send. Both signup paths call
 * this; the OAuth callback fires on every login, so the guard is what keeps a
 * returning user from being re-welcomed.
 *
 * Never throws — a failed welcome must not break signup or login.
 */
export async function maybeSendWelcome(
  userId: string,
  email: string | null,
): Promise<void> {
  if (!email) return;

  const admin = createAdminClient();

  // Claim the welcome atomically: only the row that was still unwelcomed gets
  // updated, and `select` tells us whether this call was the one that claimed
  // it. A second concurrent call updates zero rows and returns nothing.
  const { data, error } = await admin
    .from("profiles")
    .update({ welcomed_at: new Date().toISOString() })
    .eq("id", userId)
    .is("welcomed_at", null)
    .select("id");

  if (error || !data || data.length === 0) {
    // Either an error, or already welcomed (or claimed by a concurrent call).
    return;
  }

  const result = await sendWelcomeEmail(email);

  if (!result.ok) {
    // The claim already stamped welcomed_at, so a failed send won't retry. Roll
    // it back so a later login tries again, rather than silently never sending.
    console.error("Welcome email failed:", result.reason);
    await admin
      .from("profiles")
      .update({ welcomed_at: null })
      .eq("id", userId);
  }
}
