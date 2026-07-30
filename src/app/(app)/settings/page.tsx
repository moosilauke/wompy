import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { currentUserIsAdmin } from "@/lib/admin/guard";
import { lastSyncedLabel } from "@/lib/format";
import { PageShell } from "@/components/chrome/PageShell";
import { SettingsBackfillStatus } from "./SettingsBackfillStatus";
import { TabCountModePicker } from "./TabCountModePicker";
import { type EmailAccount, type TabCountMode } from "@/lib/types";
import type { BackfillJobStatus } from "@/lib/gmail/backfill";

export interface BackfillJobSummary {
  status: BackfillJobStatus;
  rangeAfter: string;
  messagesDone: number;
  messagesEstimated: number | null;
  lastError: string | null;
}

/**
 * Settings: account-level configuration, distinct from the mail view.
 *
 * Connected mailboxes, plus a Preferences section for Wompy-specific
 * settings — currently just the tab counter mode, the first of what's
 * expected to grow into a longer list over time.
 */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!isSupabaseConfigured) redirect("/login");

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims;
  if (!user) redirect("/login");
  const userEmail = typeof user.email === "string" ? user.email : null;

  const [{ data: accounts }, isAdmin, { data: profileRow }] = await Promise.all([
    supabase
      .from("email_accounts")
      .select("id, provider, email, last_synced_at")
      .order("created_at", { ascending: true }),
    currentUserIsAdmin(),
    supabase.from("profiles").select("tab_count_mode").maybeSingle(),
  ]);

  const tabCountMode: TabCountMode =
    (profileRow as { tab_count_mode: TabCountMode } | null)?.tab_count_mode ??
    "unread_messages";

  const connected = (accounts ?? []) as Pick<
    EmailAccount,
    "id" | "provider" | "email" | "last_synced_at"
  >[];

  // Backfill status per account — a separate query rather than a join, since
  // not every account has a row yet (pre-historical-sync-vintage accounts,
  // or a seed that failed silently per its own best-effort design).
  const accountIds = connected.map((a) => a.id);
  const { data: jobRows } =
    accountIds.length > 0
      ? await supabase
          .from("backfill_jobs")
          .select(
            "email_account_id, status, range_after, messages_done, messages_estimated, last_error",
          )
          .in("email_account_id", accountIds)
      : { data: [] };

  const jobByAccountId = new Map<string, BackfillJobSummary>(
    ((jobRows ?? []) as {
      email_account_id: string;
      status: BackfillJobStatus;
      range_after: string;
      messages_done: number;
      messages_estimated: number | null;
      last_error: string | null;
    }[]).map((j) => [
      j.email_account_id,
      {
        status: j.status,
        rangeAfter: j.range_after,
        messagesDone: j.messages_done,
        messagesEstimated: j.messages_estimated,
        lastError: j.last_error,
      },
    ]),
  );

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
                className={`px-4 py-3.5 ${i > 0 ? "border-t border-black/[0.06]" : ""}`}
              >
                <div className="flex items-center justify-between gap-4">
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

                {jobByAccountId.has(account.id) && (
                  <SettingsBackfillStatus
                    accountId={account.id}
                    initialJob={jobByAccountId.get(account.id)!}
                  />
                )}
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
            <p className="mb-3 text-[14px] font-bold text-text-body">
              Tab counter
            </p>
            <p className="mb-3 text-[12.5px] text-text-muted-2">
              What the number next to Contacts, Companies, and Spam shows.
            </p>
            <TabCountModePicker initialMode={tabCountMode} />
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
