import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { parseAddress } from "@/lib/email/addresses";
import { TopBar } from "./TopBar";
import { ContactRail, type RailThread } from "./ContactRail";
import {
  ReadingPane,
  type PaneMessage,
  type PaneThread,
} from "./ReadingPane";
import { CompanyPane, type CompanyMessage } from "./CompanyPane";
import type { ContactTab } from "@/lib/types";

/**
 * The authenticated app shell: contact rail + reading pane, per the design spec.
 *
 * Conversations come from participant-set threading, so a thread is "everyone on
 * the message except me" — the chat model, not Gmail's threadId or subject.
 *
 * The selected thread lives in `?thread=<id>` so it's linkable and fully
 * server-rendered; no client state library needed.
 */
export const dynamic = "force-dynamic";

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isSupabaseConfigured) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const requestedThreadId = first(params.thread);
  const tabParam = first(params.tab);
  const activeTab: ContactTab =
    tabParam === "company" || tabParam === "spam" ? tabParam : "contact";

  // Connected inbox addresses — used to decide which bubbles are "mine".
  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("email");
  const selfAddresses = new Set(
    (accounts ?? []).map((a) => (a as { email: string }).email.toLowerCase()),
  );

  // All threads, newest activity first. Fetched together so the tab counts are
  // accurate without a second round-trip.
  const { data: threadRows } = await supabase
    .from("threads")
    .select("id, participant_set, last_message_at, tab")
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const allThreads = (threadRows ?? []) as {
    id: string;
    participant_set: string[];
    last_message_at: string | null;
    tab: ContactTab;
  }[];

  const counts: Record<ContactTab, number> = {
    contact: allThreads.filter((t) => t.tab === "contact").length,
    company: allThreads.filter((t) => t.tab === "company").length,
    spam: allThreads.filter((t) => t.tab === "spam").length,
  };

  const threads = allThreads.filter((t) => t.tab === activeTab);

  // Display names for participants, gathered during threading.
  const { data: contactRows } = await supabase
    .from("contacts")
    .select("address, display_name, tab");
  const nameByAddress = new Map<string, string | null>(
    (contactRows ?? []).map((c) => {
      const row = c as { address: string; display_name: string | null };
      return [row.address, row.display_name];
    }),
  );

  const labelFor = (address: string) =>
    nameByAddress.get(address) || address.split("@")[0] || address;

  // Suggestions for the net-new compose combobox. Contacts first (real people),
  // then everyone else, so the most likely recipients surface at the top.
  const contactSuggestions = ((contactRows ?? []) as {
    address: string;
    display_name: string | null;
    tab: ContactTab;
  }[])
    .filter((c) => c.tab !== "spam")
    .sort((a, b) => {
      if (a.tab !== b.tab) return a.tab === "contact" ? -1 : 1;
      return (a.display_name || a.address).localeCompare(
        b.display_name || b.address,
      );
    })
    .map((c) => ({
      address: c.address,
      label: c.display_name || c.address.split("@")[0] || c.address,
    }));

  // Latest message per thread, for the rail snippets.
  const { data: recentRows } = await supabase
    .from("messages")
    .select("thread_id, snippet, body_text, internal_date")
    .not("thread_id", "is", null)
    .order("internal_date", { ascending: false })
    .limit(400);

  const snippetByThread = new Map<string, string>();
  for (const row of (recentRows ?? []) as {
    thread_id: string;
    snippet: string | null;
    body_text: string | null;
  }[]) {
    if (!snippetByThread.has(row.thread_id)) {
      const preview = (row.snippet || row.body_text || "").replace(/\s+/g, " ");
      snippetByThread.set(row.thread_id, preview.trim());
    }
  }

  const railThreads: RailThread[] = threads.map((t) => {
    const participants = t.participant_set ?? [];
    const primary = participants[0] ?? "";
    return {
      id: t.id,
      primaryAddress: primary,
      label: labelFor(primary),
      extraParticipants: Math.max(0, participants.length - 1),
      snippet: snippetByThread.get(t.id) ?? "",
      lastMessageAt: t.last_message_at,
      // Read/unread isn't tracked in the schema yet; the rail's unread styling
      // is in place and will light up once that data exists.
      unread: false,
    };
  });

  // Resolve the selected thread (default: most recent).
  const selected =
    threads.find((t) => t.id === requestedThreadId) ?? threads[0] ?? null;

  let paneThread: PaneThread | null = null;
  let paneMessages: PaneMessage[] = [];
  let companyMessages: CompanyMessage[] = [];

  if (selected) {
    const participants = selected.participant_set ?? [];
    const primary = participants[0] ?? "";
    paneThread = {
      id: selected.id,
      label: labelFor(primary),
      primaryAddress: primary,
      participants,
    };

    const { data: messageRows } = await supabase
      .from("messages")
      .select(
        "id, from_address, subject, body_text, body_html, snippet, internal_date, label_ids",
      )
      .eq("thread_id", selected.id)
      .order("internal_date", { ascending: activeTab === "contact" })
      // Newest-first for the list views; chronological for the chat view.
      .limit(200);

    const rows = (messageRows ?? []) as {
      id: string;
      from_address: string | null;
      subject: string | null;
      body_text: string | null;
      body_html: string | null;
      snippet: string | null;
      internal_date: string | null;
      label_ids: string[] | null;
    }[];

    if (activeTab === "contact") {
      paneMessages = rows.map((m) => {
        const from = parseAddress(m.from_address);
        return {
          id: m.id,
          // The SENT label is authoritative; fall back to matching the address
          // for rows synced before labels were captured.
          outgoing:
            (m.label_ids ?? []).includes("SENT") ||
            (from ? selfAddresses.has(from.address) : false),
          body: m.body_text,
          snippet: m.snippet,
          htmlOnly: !m.body_text && !!m.body_html,
          sentAt: m.internal_date,
        };
      });
    } else {
      companyMessages = rows.map((m) => ({
        id: m.id,
        subject: m.subject,
        body: m.body_text,
        snippet: m.snippet,
        htmlOnly: !m.body_text && !!m.body_html,
        sentAt: m.internal_date,
      }));
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        userEmail={user.email ?? null}
        activeTab={activeTab}
        counts={counts}
      />
      <div className="flex min-h-0 flex-1">
        <ContactRail
          threads={railThreads}
          selectedId={selected?.id ?? null}
          activeTab={activeTab}
          contactSuggestions={contactSuggestions}
        />
        {/* Spam uses the classic list view too — you skim it for false
            positives, you don't hold conversations in it. */}
        {activeTab === "contact" ? (
          <ReadingPane thread={paneThread} messages={paneMessages} />
        ) : (
          <CompanyPane
            thread={paneThread}
            messages={companyMessages}
            isSpam={activeTab === "spam"}
          />
        )}
      </div>
    </div>
  );
}
