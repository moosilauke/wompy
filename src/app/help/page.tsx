import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { currentUserIsAdmin } from "@/lib/admin/guard";
import { PageShell } from "@/components/chrome/PageShell";
import { ContactForm } from "./ContactForm";

/**
 * Get Help. Public — no auth required, and not gated by the proxy's
 * protected-route list. Rendered through PageShell for the same reason as
 * Privacy: a signed-in visitor still sees their account menu.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Get Help — Wompy",
  description: "Get help with Wompy, or send us a message directly.",
};

export default async function HelpPage() {
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
          Get Help
        </h1>
        <p className="mb-10 text-[14.5px] text-text-muted">
          Stuck on something, found a bug, or just have a question? Send us a
          message and we&rsquo;ll get back to you.
        </p>

        <ContactForm />

        <p className="mt-8 text-[13px] text-text-muted-2">
          You can also email us directly at{" "}
          <a
            href="mailto:hello@wompymail.com"
            className="font-semibold text-spruce hover:underline"
          >
            hello@wompymail.com
          </a>
          .
        </p>
      </div>
    </PageShell>
  );
}
