"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured, NEXT_PUBLIC_APP_URL } from "@/lib/env";
import { GMAIL_SCOPES } from "@/lib/email/providers";

type Mode = "login" | "signup";

/** Minimal email/password auth form. Deliberately plain — the designed Log in /
 * Sign up UI from the design spec comes in a later session.
 *
 * Renders a setup notice until Supabase credentials are configured. The check
 * lives in this outer component (no hooks) so the inner form's hooks always run
 * unconditionally. */
export function AuthForm({ mode }: { mode: Mode }) {
  if (!isSupabaseConfigured) {
    return (
      <div className="w-full max-w-sm">
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

  return <AuthFormFields mode={mode} />;
}

function AuthFormFields({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const next = searchParams.get("next") || "/debug";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // If email confirmation is enabled, there's no session yet.
        if (!data.session) {
          setNotice("Check your email to confirm your account, then log in.");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
      router.push(next);
      router.refresh();
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
   * access_type=offline + prompt=consent are required for Supabase to surface a
   * provider_refresh_token we can persist for ongoing Gmail API access.
   */
  async function handleGoogle() {
    setError(null);
    setPending(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
          scopes: GMAIL_SCOPES.join(" "),
          queryParams: { access_type: "offline", prompt: "consent" },
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
    <div className="w-full max-w-sm">
      <h1 className="font-display text-2xl font-bold mb-1">
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </h1>
      <p className="text-text-muted mb-6 text-sm">
        {mode === "signup"
          ? "Sign up with Google to connect Gmail in one step, or use email."
          : "Log in to Wompy."}
      </p>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={pending}
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-[100px] border border-black/15 bg-white px-5 py-2.5 font-bold text-text-body transition-opacity disabled:opacity-60"
      >
        <span
          aria-hidden
          className="inline-block h-4 w-4 rounded-full bg-gradient-to-br from-coral via-mint to-spruce"
        />
        Continue with Google
      </button>

      <div className="mb-4 flex items-center gap-3 text-xs text-text-muted-2">
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
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
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
          {pending
            ? "…"
            : mode === "signup"
              ? "Create account"
              : "Log in"}
        </button>
      </form>

      <p className="mt-5 text-sm text-text-muted">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-spruce underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New to Wompy?{" "}
            <Link href="/signup" className="font-semibold text-spruce underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
