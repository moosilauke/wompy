"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured, PUBLIC_SITE_URL } from "@/lib/env";
import { GMAIL_SCOPES } from "@/lib/email/providers";
import { welcomeCurrentUser } from "./actions";

/**
 * One form for signing in and signing up.
 *
 * A visitor doesn't know or care whether they "have an account" — that's a
 * question the product can answer for them. So there is no mode toggle: submit
 * an address and a password, and the right thing happens.
 *
 * The order (sign in first, then sign up) is forced by Supabase's
 * anti-enumeration behaviour: `signUp` on an address that already exists
 * returns a deliberately obfuscated response rather than a clear error, so it
 * can't be used to probe. `signInWithPassword` fails cleanly and unambiguously,
 * which makes it the safe thing to try first.
 *
 * Renders a setup notice until Supabase credentials are configured. That check
 * lives in this outer component (no hooks) so the inner form's hooks always run
 * unconditionally.
 */
export function AuthForm() {
  if (!isSupabaseConfigured) {
    return (
      <div className="w-full">
        <h1 className="font-display text-2xl font-bold mb-2">Almost there</h1>
        <p className="text-text-muted text-sm">
          Supabase isn’t configured yet. Copy{" "}
          <code className="rounded bg-black/5 px-1">.env.example</code> to{" "}
          <code className="rounded bg-black/5 px-1">.env.local</code>, fill in
          your Supabase and Google values, then restart the dev server. See the
          README for setup steps.
        </p>
      </div>
    );
  }

  return <AuthFormFields />;
}

/** Supabase's message for a failed password sign-in. */
const INVALID_CREDENTIALS = "invalid login credentials";

function AuthFormFields() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  // The landing page's composer hands the address over in the URL, so someone
  // who typed it there doesn't have to type it again.
  const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set when the address belongs to an account that has no password, so the
  // form can point at Google instead of repeating a failure the user can't fix.
  const [useGoogleInstead, setUseGoogleInstead] = useState(false);
  const [pending, setPending] = useState(false);

  const next = searchParams.get("next") || "/app";

  function finish() {
    router.push(next);
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setUseGoogleInstead(false);
    setPending(true);

    try {
      // 1. Assume they're returning. This is the common case for anyone past
      //    their first visit, and it fails cleanly if they're not.
      const signIn = await supabase.auth.signInWithPassword({ email, password });
      if (!signIn.error) {
        finish();
        return;
      }

      const message = signIn.error.message.toLowerCase();
      if (!message.includes(INVALID_CREDENTIALS)) {
        // Something other than a credential mismatch — rate limiting, an
        // unconfirmed address, a network failure. Report it as-is rather than
        // creating an account in response to an unrelated problem.
        throw signIn.error;
      }

      // 2. Credentials didn't match. Either the account doesn't exist yet, or
      //    it does and the password is wrong.
      const signUp = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Tell Supabase where the confirmation link should land, rather than
          // relying solely on the dashboard Site URL — PUBLIC_SITE_URL never
          // resolves to localhost, so a stale dashboard setting can't send a
          // real user a broken confirmation link.
          emailRedirectTo: `${PUBLIC_SITE_URL}/auth/callback`,
        },
      });
      if (signUp.error) throw signUp.error;

      // Supabase signals "this address is already registered" by returning a
      // user with an empty identities array — the obfuscated response that
      // avoids confirming the address exists. There is no new account here.
      const alreadyRegistered = (signUp.data.user?.identities?.length ?? 0) === 0;
      if (alreadyRegistered) {
        // The account exists but the password didn't work. The likeliest cause
        // is that it was created with Google and has no password at all, so
        // offer that route as well as the plain wrong-password reading.
        setUseGoogleInstead(true);
        setError(
          "That didn’t match. If you created this account with Google, use the button above.",
        );
        return;
      }

      if (!signUp.data.session) {
        // Email confirmation is enabled, so there's no session yet. The welcome
        // fires later, when they click the confirmation link and hit
        // /auth/callback.
        setNotice("Check your email to confirm your account, then come back.");
        return;
      }

      // New account with an immediate session (confirmation disabled). This path
      // bypasses /auth/callback, so send the welcome here. Fire-and-forget — a
      // welcome failure must not hold up entering the app.
      void welcomeCurrentUser();
      finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  /**
   * "Continue with Google" — uses Google as the login identity AND requests
   * Gmail scopes in the same consent, so the inbox can connect in one step. The
   * user may decline the Gmail scope and still get an account; the auth callback
   * only creates an email_accounts row if Gmail access was actually granted.
   *
   * Deliberately NOT `prompt: "consent"`. That flag forces Google's permission
   * screen on every sign-in, including returning users who granted everything
   * months ago — friction other sites don't impose. It exists on the explicit
   * "Connect Gmail" path (lib/gmail/auth.ts), where guaranteeing a refresh_token
   * on first grant actually matters.
   *
   * Safe to omit here because Google only issues a refresh_token on first
   * authorization anyway, and upsertGoogleTokensForUser keeps the stored one
   * when a later response omits it. If a refresh token is genuinely missing or
   * revoked, the app surfaces a reconnect prompt rather than silently failing —
   * which also covers access revoked from Google's side, something no amount of
   * re-prompting would catch.
   *
   * access_type=offline is still required for a refresh_token to be issued at
   * all on the first grant.
   */
  async function handleGoogle() {
    setError(null);
    setPending(true);
    try {
      // The browser's real origin, not a build-time-inlined env var. This is
      // correct in every environment automatically — localhost locally,
      // www.wompymail.com in production — so a missing or stale
      // NEXT_PUBLIC_APP_URL at build time can't send prod users to localhost.
      const origin = window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
          scopes: GMAIL_SCOPES.join(" "),
          queryParams: { access_type: "offline" },
        },
      });
      if (error) throw error;
      // On success the browser is redirected to Google; nothing runs after this.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPending(false);
    }
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={handleGoogle}
        disabled={pending}
        className={`flex w-full items-center justify-center gap-2 rounded-[100px] border bg-white px-5 py-2.5 font-bold text-text-body transition-all disabled:opacity-60 ${
          useGoogleInstead
            ? "border-coral ring-2 ring-coral/30"
            : "border-black/15"
        }`}
      >
        <span
          aria-hidden
          className="inline-block h-4 w-4 rounded-full bg-gradient-to-br from-coral via-mint to-spruce"
        />
        Continue with Google
      </button>

      <p className="mt-2 text-center text-[12px] text-text-muted-2">
        Connects Gmail in the same step.
      </p>

      <div className="my-4 flex items-center gap-3 text-xs text-text-muted-2">
        <span className="h-px flex-1 bg-black/10" />
        or
        <span className="h-px flex-1 bg-black/10" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-[14px] border border-black/10 bg-white px-4 py-2.5 font-normal outline-none focus:border-mint"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-semibold">
          Password
          <input
            type="password"
            required
            minLength={6}
            // Neither "new-password" nor "current-password" is right when the
            // form serves both; this lets a password manager offer either.
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-[14px] border border-black/10 bg-white px-4 py-2.5 font-normal outline-none focus:border-mint"
          />
        </label>

        {error && <p className="text-sm text-coral">{error}</p>}
        {notice && <p className="text-sm text-spruce">{notice}</p>}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-[100px] bg-coral px-5 py-2.5 font-bold text-white shadow-[0_4px_14px_rgba(226,114,90,0.35)] transition-opacity disabled:opacity-60"
        >
          {pending ? "…" : "Continue"}
        </button>
      </form>

      <p className="mt-4 text-center text-[12px] text-text-muted-2">
        New here? We’ll create your account. Already have one? We’ll sign you in.
      </p>
    </div>
  );
}
