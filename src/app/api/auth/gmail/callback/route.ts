import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createOAuthClient,
  fetchGmailAddress,
  upsertGoogleTokensForUser,
} from "@/lib/gmail/auth";
import { seedBackfillJob } from "@/lib/gmail/backfill";

/**
 * Explicit "Connect Gmail" callback (for users who signed in some other way and
 * are adding a Gmail inbox). Exchanges the code for tokens, reads the connected
 * account's email, and upserts an email_accounts row (provider='gmail').
 *
 * The user id arrives in `state`; we re-verify the session and require the two to
 * match, so a stray callback can't attach an account to someone else.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // = user id from /start
  const oauthError = searchParams.get("error");

  // The browser's real request origin, not NEXT_PUBLIC_APP_URL — that constant
  // is meant for contexts with no request to derive an origin from (e.g. email
  // links), and reusing it here sent every local "Connect Gmail" redirect to
  // production regardless of what environment initiated the OAuth round-trip.
  const redirect = (params: string) =>
    NextResponse.redirect(new URL(`/debug?${params}`, origin));

  if (oauthError) return redirect(`gmail=error&reason=${oauthError}`);
  if (!code || !state) return redirect("gmail=error&reason=missing_params");

  // Verify the signed-in user matches the state we issued.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== state) {
    return redirect("gmail=error&reason=auth_mismatch");
  }

  // Each step below can throw (network failure, revoked consent, missing DB
  // tables). Surface a readable reason instead of letting it bubble up as an
  // opaque 500 — an unapplied migration used to fail exactly this way.
  try {
    // Exchange the code for tokens.
    const oauth = createOAuthClient();
    const { tokens } = await oauth.getToken(code);

    // Read the connected account's email address.
    const email = await fetchGmailAddress(tokens);
    if (!email) return redirect("gmail=error&reason=no_email");

    // Persist via the shared upsert (same write path as Google-auth signup).
    const { error, accountId } = await upsertGoogleTokensForUser(
      user.id,
      email,
      tokens,
    );
    if (error) {
      return redirect(
        `gmail=error&reason=save_failed&detail=${encodeURIComponent(error)}`,
      );
    }

    // Seed historical-sync's job row so the in-app progress banner (once
    // built) picks it up on the next page load. Best-effort: a failure here
    // must not block the connect itself, since the account is already
    // usable for regular sync either way — worst case, backfill just never
    // starts for this account until reconnected, which is recoverable.
    if (accountId) {
      try {
        await seedBackfillJob(user.id, accountId);
      } catch {
        // Swallowed deliberately — see comment above.
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown";
    return redirect(
      `gmail=error&reason=connect_failed&detail=${encodeURIComponent(detail)}`,
    );
  }

  return redirect("gmail=connected");
}
