"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The composer, doubling as the sign-up field.
 *
 * This is the page's only interactive element, so it is the only client
 * component — everything else renders as static HTML. Keeping the JS payload to
 * one small island is the difference between a landing page that paints
 * instantly and one that waits on hydration.
 *
 * Submitting hands off to the real signup flow with the address prefilled,
 * rather than capturing it somewhere separate.
 */
export function SignupComposer() {
  const router = useRouter();
  const [email, setEmail] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    router.push(`/signup?email=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="shrink-0 border-t border-black/[0.06] bg-cream px-7 py-4 shadow-[0_-4px_18px_rgba(0,0,0,0.05)]">
      <p className="mb-2 text-center text-[12px] font-bold text-text-muted-3">
        Joined by 12,000+ early users
      </p>
      <form onSubmit={submit} className="flex items-center gap-2.5">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Type your email to get started…"
          aria-label="Your email address"
          className="min-w-0 flex-1 rounded-full border border-black/[0.08] bg-white px-5 py-3 text-[14.5px] font-medium text-text-body placeholder:text-text-muted-3 focus:border-coral/40 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Get started"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-coral text-white shadow-[0_4px_12px_oklch(0.5_0.12_25_/_0.4)] transition-opacity hover:opacity-90"
        >
          {/* Paper-plane, inline so there is no icon-font or SVG request. */}
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" fill="currentColor" />
          </svg>
        </button>
      </form>
    </div>
  );
}
