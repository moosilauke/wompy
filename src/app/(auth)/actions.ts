"use server";

import { createClient } from "@/lib/supabase/server";
import { maybeSendWelcome } from "@/lib/email/welcome";

/**
 * Send the welcome email to the currently-signed-in user, if they haven't been
 * welcomed yet.
 *
 * Called by the client after an email/password signup that lands a session
 * immediately (email-confirmation disabled), which bypasses the OAuth callback
 * where the OAuth path is welcomed. Reads the user from their OWN verified
 * session — no user id is accepted from the caller — so it can only ever
 * welcome the person making the request, and maybeSendWelcome's welcomed_at
 * guard makes it a no-op if they've already been welcomed.
 */
export async function welcomeCurrentUser(): Promise<void> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  const email = claims?.claims?.email;
  if (!userId) return;

  await maybeSendWelcome(
    userId,
    typeof email === "string" ? email : null,
  );
}
