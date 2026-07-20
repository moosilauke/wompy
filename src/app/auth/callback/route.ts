import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchGmailAddress,
  upsertGoogleTokensForUser,
} from "@/lib/gmail/auth";

/**
 * Supabase auth callback. Handles:
 *  - email-confirmation links (exchange `code` for a session), and
 *  - "Continue with Google" sign-in.
 *
 * For the Google path, the session carries a one-time `provider_token` /
 * `provider_refresh_token` (Supabase does NOT persist these). If the user granted
 * Gmail access, we capture them here and create the email_accounts row — the
 * one-step connect. If Gmail was declined (or this is a plain email confirmation),
 * we just sign them in. This is what makes the combined Gmail connect optional.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/debug";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // Optional one-step Gmail connect: only when Google returned a provider token
  // AND the Gmail scope was actually granted (probed via the profile call).
  const session = data.session;
  const providerToken = session?.provider_token;
  const providerRefreshToken = session?.provider_refresh_token;
  const user = data.user ?? session?.user;

  if (providerToken && user) {
    try {
      const email = await fetchGmailAddress({
        access_token: providerToken,
        refresh_token: providerRefreshToken ?? null,
      });
      if (email) {
        await upsertGoogleTokensForUser(user.id, email, {
          access_token: providerToken,
          refresh_token: providerRefreshToken ?? null,
          // Supabase doesn't surface the Google token expiry here; leave null so
          // getAuthorizedClient treats it as "refresh on next use".
          expiry_date: null,
        });
      }
    } catch {
      // Gmail scope not granted (or profile fetch failed) → account only, no
      // inbox connected. The user can connect Gmail later from /debug.
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
