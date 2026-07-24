import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { currentUserIsAdmin } from "@/lib/admin/guard";
import { PageShell } from "@/components/chrome/PageShell";

/**
 * About Wompy. Public — no auth required, and not gated by the proxy's
 * protected-route list. Rendered through PageShell for the same reason as
 * Privacy: a signed-in visitor still sees their account menu.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About Wompy — Wompy",
  description: "Why Wompy turns your inbox into a conversation, not a filing cabinet.",
};

export default async function AboutPage() {
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
          About Wompy
        </h1>
        <p className="mb-10 text-[13px] text-text-muted-2">
          Email built like texting in 2026, not letter-writing in 1926.
        </p>

        <div className="flex flex-col gap-8 text-[14.5px] leading-relaxed text-text-body [&_h2]:mb-2.5 [&_h2]:font-display [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:text-text-body [&_p]:text-text-muted [&_li]:text-text-muted [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1">
          <section>
            <p className="text-text-muted">
              Email hasn&rsquo;t changed much since it was invented — subject
              lines, signatures, and a wall of separate threads from the same
              person. Wompy turns your inbox into one continuous conversation
              per person or company, the way texting already works, so mail
              feels like talking to someone instead of filing paperwork.
            </p>
          </section>

          <section>
            <h2>What&rsquo;s different</h2>
            <ul>
              <li>
                <strong>One chat per person or group.</strong> Every message
                from someone lives in a single thread, not scattered across
                subject lines.
              </li>
              <li>
                <strong>Feels like texting.</strong> Familiar bubbles and
                quick replies, not a dense corporate inbox.
              </li>
              <li>
                <strong>Cuts the bloat.</strong> No subject lines, no
                signatures, no AI-generated filler — just what you meant to
                say.
              </li>
            </ul>
          </section>

          <section>
            <h2>Where we are</h2>
            <p>
              Wompy is early. We&rsquo;re a small team building this because
              we wanted it to exist, and we&rsquo;re shipping fast — the
              product will keep changing as we hear from the people using it.
            </p>
          </section>

          <section>
            <h2>Get in touch</h2>
            <p>
              Questions, feedback, or ideas? We&rsquo;d like to hear them —
              visit{" "}
              <a href="/help" className="font-semibold text-spruce hover:underline">
                Get Help
              </a>{" "}
              or email us at{" "}
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
