import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createOAuthClient,
  fetchGmailAddress,
  upsertGoogleTokensForUser,
} from "@/lib/gmail/auth";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env";

/**
 * Explicit "Connect Gmail" callback (for users who signed in some other way and
 * are adding a Gmail inbox). Exchanges the code for tokens, reads the connected
 * account's email, and upserts an email_accounts row (provider='gmail').
 *
 * The user id arrives in `state`; we re-verify the session and require the two to
 * match, so a stray callback can't attach an account to someone else.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // = user id from /start
  const oauthError = searchParams.get("error");

  const redirect = (params: string) =>
    NextResponse.redirect(new URL(`/debug?${params}`, NEXT_PUBLIC_APP_URL));

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

  // Exchange the code for tokens.
  const oauth = createOAuthClient();
  const { tokens } = await oauth.getToken(code);

  // Read the connected account's email address.
  const email = await fetchGmailAddress(tokens);
  if (!email) return redirect("gmail=error&reason=no_email");

  // Persist via the shared upsert (same write path as Google-auth signup).
  const { error } = await upsertGoogleTokensForUser(user.id, email, tokens);
  if (error) return redirect("gmail=error&reason=save_failed");

  return redirect("gmail=connected");
}
