import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { currentUserIsAdmin } from "@/lib/admin/guard";
import { lastSyncedLabel } from "@/lib/format";
import { PageShell } from "@/components/chrome/PageShell";
import type { EmailAccount } from "@/lib/types";

/**
 * Settings: account-level configuration, distinct from the mail view.
 *
 * Starts with connected mailboxes (the one thing that actually needs
 * configuring today) plus a Preferences section reserved for Wompy-specific
 * settings that don't exist yet — kept visible-but-empty rather than omitted,
 * so the page's eventual shape is obvious as those land.
 */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!isSupabaseConfigured) redirect("/login");

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims;
  if (!user) redirect("/login");
  const userEmail = typeof user.email === "string" ? user.email : null;

  const [{ data: accounts }, isAdmin] = await Promise.all([
    supabase
      .from("email_accounts")
      .select("id, provider, email, last_synced_at")
      .order("created_at", { ascending: true }),
    currentUserIsAdmin(),
  ]);

  const connected = (accounts ?? []) as Pick<
    EmailAccount,
    "id" | "provider" | "email" | "last_synced_at"
  >[];

  return (
    <PageShell
      userEmail={userEmail}
      isAdmin={isAdmin}
      back={{ href: "/app", label: "Back to app" }}
    >
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="mb-6 font-display text-2xl font-bold text-text-body">
          Settings
        </h1>

        <section className="mb-8">
          <h2 className="mb-3 text-[13px] font-extrabold uppercase tracking-[0.4px] text-text-muted-2">
            Connected mailboxes
          </h2>

          <div className="overflow-hidden rounded-[14px] border border-black/[0.06] bg-white">
            {connected.length === 0 && (
              <p className="px-4 py-4 text-sm text-text-muted">
                No mailbox connected yet.
              </p>
            )}

            {connected.map((account, i) => (
              <div
                key={account.id}
                className={`flex items-center justify-between gap-4 px-4 py-3.5 ${
                  i > 0 ? "border-t border-black/[0.06]" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-bold text-text-body">
                    {account.email}
                  </p>
                  <p className="text-[12.5px] text-text-muted-2">
                    {providerLabel(account.provider)} ·{" "}
                    {lastSyncedLabel(account.last_synced_at)}
                  </p>
                </div>
                <a
                  href="/api/auth/gmail/start"
                  className="shrink-0 rounded-full border border-black/10 px-3.5 py-1.5 text-[12.5px] font-bold text-text-body transition-colors hover:bg-black/[0.04]"
                >
                  Reconnect
                </a>
              </div>
            ))}
          </div>

          <a
            href="/api/auth/gmail/start"
            className="mt-3 inline-block text-[13px] font-bold text-spruce hover:underline"
          >
            + Connect another mailbox
          </a>
        </section>

        <section>
          <h2 className="mb-3 text-[13px] font-extrabold uppercase tracking-[0.4px] text-text-muted-2">
            Preferences
          </h2>
          <div className="rounded-[14px] border border-black/[0.06] bg-white px-4 py-4">
            <p className="text-sm text-text-muted">
              Wompy-specific preferences are coming here — notification
              behavior, default views, and the like.
            </p>
          </div>
        </section>
      </div>
    </PageShell>
  );
}

function providerLabel(provider: string): string {
  if (provider === "gmail") return "Gmail";
  if (provider === "yahoo") return "Yahoo";
  return provider;
}
