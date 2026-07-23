import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { currentUserIsAdmin } from "@/lib/admin/guard";
import { PageShell } from "@/components/chrome/PageShell";

/**
 * Privacy policy. Public — no auth required, and not gated by the proxy's
 * protected-route list.
 *
 * Still rendered through PageShell so a signed-in visitor sees their own
 * account menu and a way back into the app; an anonymous visitor just gets
 * the brand mark. dynamic = "force-dynamic" because that session check has to
 * run per-request — this page isn't on the hot conversion path the static
 * landing page is optimized for, so the cost doesn't matter here.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy Policy — Wompy",
  description: "How Wompy collects, uses, and protects your data.",
};

const LAST_UPDATED = "July 23, 2026";

export default async function PrivacyPage() {
  let userEmail: string | null = null;
  let isAdmin = false;

  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const email = claims?.claims?.email;
    userEmail = typeof email === "string" ? email : null;
    if (userEmail) isAdmin = await currentUserIsAdmin();
  }

  return (
    <PageShell userEmail={userEmail} isAdmin={isAdmin}>
      <div className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="mb-2 font-display text-2xl font-bold text-text-body">
          Privacy Policy
        </h1>
        <p className="mb-10 text-[13px] text-text-muted-2">
          Last updated {LAST_UPDATED}
        </p>

        <div className="flex flex-col gap-8 text-[14.5px] leading-relaxed text-text-body [&_h2]:mb-2.5 [&_h2]:font-display [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:text-text-body [&_p]:text-text-muted [&_li]:text-text-muted [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1">
          <section>
            <p className="text-text-muted">
              Wompy (&ldquo;we&rdquo;, &ldquo;us&rdquo;) turns your inbox into
              a chat-style conversation with each person and company you
              email. This policy explains what we collect to do that, why,
              and what choices you have. Wompy is early — this policy will
              evolve as the product does, and we&rsquo;ll update the date
              above whenever it does.
            </p>
          </section>

          <section>
            <h2>What we collect</h2>
            <ul>
              <li>
                <strong>Account info:</strong> your email address, and a
                password if you sign up that way rather than with Google.
              </li>
              <li>
                <strong>Email content:</strong> when you connect a mailbox
                (currently Gmail), we access messages, threads, and labels via
                Google&rsquo;s API so we can display and organize your mail
                as conversations. This includes message bodies, senders,
                recipients, and attachments.
              </li>
              <li>
                <strong>Usage data:</strong> basic product analytics —
                currently limited to what we need to operate the service
                (error logs, request timing). We plan to add a privacy-
                conscious analytics tool (such as PostHog) and/or Google
                Analytics to understand how Wompy is used and improve it; if
                and when we do, this section will be updated with specifics on
                what&rsquo;s collected and how to opt out, before it goes
                live.
              </li>
            </ul>
          </section>

          <section>
            <h2>How we use it</h2>
            <ul>
              <li>To show your mail as conversations and keep it in sync.</li>
              <li>
                To operate account features like sign-in, read/unread state,
                and reactions.
              </li>
              <li>
                To send you account-related email — welcome messages,
                password resets, and similar transactional mail.
              </li>
              <li>
                Once added, aggregated product analytics to understand usage
                patterns and improve the app — never to sell your data or
                target you with third-party advertising.
              </li>
            </ul>
          </section>

          <section>
            <h2>Google user data</h2>
            <p>
              Wompy&rsquo;s use and transfer of information received from
              Google APIs adheres to the{" "}
              <span className="font-semibold text-text-body">
                Google API Services User Data Policy
              </span>
              , including the Limited Use requirements. We request only the
              Gmail access needed to display and organize your mail, and we
              never use it to serve ads. OAuth tokens are encrypted at rest,
              separately from the database itself, so a database compromise
              alone doesn&rsquo;t expose usable mailbox credentials. Revoking
              Wompy&rsquo;s access from your Google Account settings
              disconnects the mailbox immediately.
            </p>
          </section>

          <section>
            <h2>Who we share it with</h2>
            <p>
              We don&rsquo;t sell your data. A small number of service providers
              process it on our behalf, under their own privacy and security
              commitments, strictly to run Wompy:
            </p>
            <ul>
              <li>
                <strong>Google</strong> — to access Gmail on your behalf, per
                the permissions you grant.
              </li>
              <li>
                <strong>Supabase</strong> — our database and authentication
                provider, where account and message data is stored.
              </li>
              <li>
                <strong>Mailtrap</strong> — delivers transactional email (e.g.
                password resets) on our behalf.
              </li>
              <li>
                <strong>Future analytics providers</strong> (e.g. PostHog,
                Google Analytics) — if added, they would receive usage data as
                described above, not email content.
              </li>
            </ul>
          </section>

          <section>
            <h2>Your choices</h2>
            <ul>
              <li>
                Disconnect a mailbox any time from Settings, or by revoking
                access in your Google Account.
              </li>
              <li>
                Request deletion of your account and associated data by
                emailing us (below) — this removes your profile, connected
                mailboxes, and stored messages.
              </li>
              <li>
                Once analytics are added, we&rsquo;ll provide a way to opt out
                of non-essential tracking.
              </li>
            </ul>
          </section>

          <section>
            <h2>Contact</h2>
            <p>
              Questions about this policy or your data? Email us at{" "}
              <a
                href="mailto:hello@wompymail.com"
                className="font-semibold text-spruce hover:underline"
              >
                hello@wompymail.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
