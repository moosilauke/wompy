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
  const rawThreadParam = params.thread;
  const requestedThreadId = Array.isArray(rawThreadParam)
    ? rawThreadParam[0]
    : rawThreadParam;

  // Connected inbox addresses — used to decide which bubbles are "mine".
  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("email");
  const selfAddresses = new Set(
    (accounts ?? []).map((a) => (a as { email: string }).email.toLowerCase()),
  );

  // Threads, newest activity first.
  const { data: threadRows } = await supabase
    .from("threads")
    .select("id, participant_set, last_message_at")
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const threads = (threadRows ?? []) as {
    id: string;
    participant_set: string[];
    last_message_at: string | null;
  }[];

  // Display names for participants, gathered during threading.
  const { data: contactRows } = await supabase
    .from("contacts")
    .select("address, display_name");
  const nameByAddress = new Map<string, string | null>(
    (contactRows ?? []).map((c) => {
      const row = c as { address: string; display_name: string | null };
      return [row.address, row.display_name];
    }),
  );

  const labelFor = (address: string) =>
    nameByAddress.get(address) || address.split("@")[0] || address;

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
      .select("id, from_address, body_text, body_html, snippet, internal_date")
      .eq("thread_id", selected.id)
      .order("internal_date", { ascending: true })
      .limit(200);

    paneMessages = ((messageRows ?? []) as {
      id: string;
      from_address: string | null;
      body_text: string | null;
      body_html: string | null;
      snippet: string | null;
      internal_date: string | null;
    }[]).map((m) => {
      const from = parseAddress(m.from_address);
      return {
        id: m.id,
        outgoing: from ? selfAddresses.has(from.address) : false,
        body: m.body_text,
        snippet: m.snippet,
        htmlOnly: !m.body_text && !!m.body_html,
        sentAt: m.internal_date,
      };
    });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar userEmail={user.email ?? null} />
      <div className="flex min-h-0 flex-1">
        <ContactRail threads={railThreads} selectedId={selected?.id ?? null} />
        <ReadingPane thread={paneThread} messages={paneMessages} />
      </div>
    </div>
  );
}
