import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { currentUserIsAdmin } from "@/lib/admin/guard";
import { PageShell } from "@/components/chrome/PageShell";

/**
 * Documentation. Public — no auth required, and not gated by the proxy's
 * protected-route list. Rendered through PageShell for the same reason as
 * Privacy: a signed-in visitor still sees their account menu.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Documentation — Wompy",
  description: "How to get started with Wompy and get the most out of it.",
};

export default async function DocsPage() {
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
          Documentation
        </h1>
        <p className="mb-10 text-[13px] text-text-muted-2">
          Everything you need to get started with Wompy.
        </p>

        <div className="flex flex-col gap-8 text-[14.5px] leading-relaxed text-text-body [&_h2]:mb-2.5 [&_h2]:font-display [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:text-text-body [&_p]:text-text-muted [&_li]:text-text-muted [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1">
          <section>
            <h2>Getting started</h2>
            <p>
              Sign up with your email and a password, or continue with
              Google. Signing up with Google connects your Gmail in the same
              step; otherwise, connect a mailbox from the app once
              you&rsquo;re in. Wompy currently supports Gmail.
            </p>
          </section>

          <section>
            <h2>How conversations work</h2>
            <ul>
              <li>
                Every message from a person or company lands in one running
                conversation, not a separate thread per subject line.
              </li>
              <li>
                New mail syncs automatically. You can also trigger a manual
                sync from the account menu in the top bar.
              </li>
              <li>
                Replying works like a chat: type your message in the composer
                at the bottom of the conversation and send.
              </li>
              <li>
                A long conversation opens on its most recent messages. Use
                “Load earlier messages” at the top to keep reading back through
                its history.
              </li>
            </ul>
          </section>

          <section>
            <h2>Seeing the original email</h2>
            <p>
              Wompy shows you the message and strips the cruft — quoted reply
              chains, signatures, and the layout scaffolding most email is
              wrapped in. Links stay clickable, and open in a new tab.
            </p>
            <p>
              The original isn&rsquo;t lost. Right-click any message and choose{" "}
              <strong>View original</strong> to see it exactly as its sender
              built it, with their images, colours, and layout intact.
            </p>
            <p>
              Images in that view are blocked until you ask for them. Loading
              an image tells the sender you opened the message and when — many
              marketing emails include an invisible one purely to track that.
              Click <strong>Show images</strong> when you want them, or turn on{" "}
              <strong>Always load images</strong> in Settings if you&rsquo;d
              rather mail always looked as designed.
            </p>
          </section>

          <section>
            <h2>Reactions</h2>
            <p>
              Hover or long-press a message bubble to react to it, the same
              way you would in a messaging app. Reactions sync back to Gmail
              as a reply, so the person on the other end sees it too.
            </p>
          </section>

          <section>
            <h2>Unread badges</h2>
            <p>
              The badge on a conversation shows how many messages in it are
              unread. Opening a conversation marks its messages as read.
            </p>
          </section>

          <section>
            <h2>Your stats</h2>
            <p>
              Find <strong>Stats</strong> in the account menu for a few fun
              numbers pulled from your own mail — your busiest contact,
              longest conversation, fastest reply, and more. Nothing here
              leaves your account, and it only covers mail that&rsquo;s
              actually been synced — the page notes how far back that goes,
              with a link to sync more if you want deeper history included.
            </p>
          </section>

          <section>
            <h2>Account and privacy</h2>
            <p>
              You can disconnect a mailbox at any time from Settings, or by
              revoking Wompy&rsquo;s access in your Google Account. See the{" "}
              <a href="/privacy" className="font-semibold text-spruce hover:underline">
                Privacy Policy
              </a>{" "}
              for details on what we collect and why.
            </p>
          </section>

          <section>
            <h2>Still stuck?</h2>
            <p>
              Visit{" "}
              <a href="/help" className="font-semibold text-spruce hover:underline">
                Get Help
              </a>{" "}
              to send us a message, or email{" "}
              <a
                href="mailto:hello@wompymail.com"
                className="font-semibold text-spruce hover:underline"
              >
                hello@wompymail.com
              </a>{" "}
              directly.
            </p>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
