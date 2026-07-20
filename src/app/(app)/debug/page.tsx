import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { signOut } from "../actions";
import { DebugActions } from "./DebugActions";
import type { EmailAccount, MessageRow } from "@/lib/types";

/**
 * Throwaway debug view to validate MVP step 1 end-to-end: connect Gmail, run a
 * sync, and confirm rows landed in `messages`. NOT the designed UI — the real
 * Contacts/Companies views and landing page come in later sessions.
 *
 * Reads go through the RLS-scoped server client, so this only ever shows the
 * signed-in user's own data.
 */
export default async function DebugPage() {
  // Not configured yet → the proxy can't gate this route, so guard here.
  if (!isSupabaseConfigured) redirect("/login");

  const supabase = await createClient();

  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("id, provider, email, last_synced_at, refresh_token")
    .order("created_at", { ascending: true });

  const { data: messages } = await supabase
    .from("messages")
    .select("id, from_address, subject, snippet, internal_date, raw_headers")
    .order("internal_date", { ascending: false })
    .limit(50);

  const accountList = (accounts ?? []) as Pick<
    EmailAccount,
    "id" | "provider" | "email" | "last_synced_at" | "refresh_token"
  >[];
  const messageList = (messages ?? []) as Pick<
    MessageRow,
    "id" | "from_address" | "subject" | "snippet" | "internal_date" | "raw_headers"
  >[];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="font-display text-2xl font-bold">Wompy — debug</h1>
        <p className="text-sm text-text-muted">
          Backend-foundation scaffolding. Not the real UI.
        </p>
      </header>

      <DebugActions signOutAction={signOut} />

      <section>
        <h2 className="mb-2 font-display text-lg font-semibold">
          Connected inboxes
        </h2>
        {accountList.length === 0 ? (
          <p className="text-sm text-text-muted">
            None yet. Click “Connect Gmail”, or sign up with Google to connect in
            one step.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {accountList.map((a) => (
              <li
                key={a.id}
                className="rounded-[14px] bg-white p-3 text-sm shadow-[0_2px_8px_rgba(0,0,0,0.05)]"
              >
                <span className="mr-2 rounded-full bg-mint/30 px-2 py-0.5 text-xs font-bold uppercase text-spruce">
                  {a.provider}
                </span>
                <span className="font-semibold">{a.email}</span>{" "}
                <span className="text-text-muted">
                  · refresh token: {a.refresh_token ? "yes" : "no"} · last synced:{" "}
                  {a.last_synced_at ?? "never"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-display text-lg font-semibold">
          Recent messages ({messageList.length})
        </h2>
        {messageList.length === 0 ? (
          <p className="text-sm text-text-muted">
            No messages synced yet. Connect an account and hit “Sync now”. New
            mail arriving after you connect will show up on the next sync (no
            history backfill).
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messageList.map((m) => {
              const listUnsub = m.raw_headers?.["list-unsubscribe"];
              const precedence = m.raw_headers?.["precedence"];
              return (
                <li
                  key={m.id}
                  className="rounded-[14px] bg-white p-3 text-sm shadow-[0_2px_8px_rgba(0,0,0,0.05)]"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-semibold">
                      {m.from_address ?? "(no from)"}
                    </span>
                    <span className="shrink-0 text-xs text-text-muted-2">
                      {m.internal_date
                        ? new Date(m.internal_date).toLocaleString()
                        : ""}
                    </span>
                  </div>
                  <div className="truncate text-text-muted">
                    {m.subject ?? "(no subject)"}
                  </div>
                  <div className="truncate text-xs text-text-muted-2">
                    {m.snippet}
                  </div>
                  {(listUnsub || precedence) && (
                    <div className="mt-1 text-xs text-spruce">
                      classifier signal:{" "}
                      {listUnsub ? "List-Unsubscribe " : ""}
                      {precedence ? `Precedence=${precedence}` : ""}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
