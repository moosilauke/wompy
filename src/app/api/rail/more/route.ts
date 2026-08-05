import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { normalizeSnippet } from "@/lib/email/text";
import { fallbackLabel } from "@/lib/email/addresses";
import { canReactTo } from "@/lib/email/reactions";
import { brandLogoUrl, logoDomainFor } from "@/lib/email/logos";
import type { ContactTab } from "@/lib/types";
import type { RailThread } from "@/app/(app)/app/ContactRail";

/**
 * "Load more" for the rail: the next page of threads for one tab, continuing
 * from a keyset cursor rather than an offset.
 *
 * Keyset (seek) pagination, not offset: the rail's first page (page.tsx) is
 * refetched fresh on every regular sync via router.refresh(), so an
 * offset-based "page 2" would shift underneath a user who has new mail
 * arrive between loading page 1 and clicking Load More, causing skipped or
 * duplicated rows. Continuing strictly after (last_message_at, id) doesn't
 * have that problem — it names an exact position in the ordering rather
 * than counting rows from the top.
 *
 * All reads go through the RLS-scoped client (not the admin client) — this
 * route only ever needs the calling user's own rows, so there's no reason
 * to bypass RLS here.
 */
const PAGE_SIZE = 200;

interface Cursor {
  lastMessageAt: string | null;
  id: string;
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { tab?: ContactTab; cursor?: Cursor };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const tab = body.tab;
  if (tab !== "contact" && tab !== "company" && tab !== "spam") {
    return NextResponse.json({ error: "invalid_tab" }, { status: 400 });
  }
  const cursor = body.cursor;
  if (!cursor || typeof cursor.id !== "string") {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  // Continue strictly after the cursor's position in the same
  // (last_message_at desc, id desc) ordering the initial page used. A null
  // last_message_at already sorts last, so a null-cursor continuation is
  // just "id < cursor.id among the null group" — expressed directly rather
  // than folded into the same .or() as the non-null case, since PostgREST's
  // filter syntax doesn't compose an `is null` check inside `.or()` cleanly.
  let query = supabase
    .from("threads")
    .select("id, participant_set, last_message_at, tab")
    .eq("tab", tab)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);

  query =
    cursor.lastMessageAt === null
      ? query.is("last_message_at", null).lt("id", cursor.id)
      : query.or(
          `last_message_at.lt.${cursor.lastMessageAt},and(last_message_at.eq.${cursor.lastMessageAt},id.lt.${cursor.id})`,
        );

  const { data: threadRows, error: threadsError } = await query;
  if (threadsError) {
    return NextResponse.json({ error: "load_threads_failed" }, { status: 500 });
  }

  const threads = (threadRows ?? []) as {
    id: string;
    participant_set: string[];
    last_message_at: string | null;
    tab: ContactTab;
  }[];

  if (threads.length === 0) {
    return NextResponse.json({ threads: [], nextCursor: null });
  }

  const threadIds = threads.map((t) => t.id);
  const participantAddresses = [
    ...new Set(threads.flatMap((t) => t.participant_set ?? [])),
  ];

  // RPCs, not `.in(...)`: PostgREST builds an `.in()` filter into the request
  // URL, and at a full PAGE_SIZE page that URL can run past undici's ~16KB
  // header limit — the request then throws before reaching Postgres at all.
  // Silent, too, since `{ data }` alone (no `error`) was all any call site
  // here checked. See migration 0030 and src/app/(app)/app/page.tsx for the
  // full story — that's where this was first caught, showing as every
  // thread rendering unread regardless of its real read state.
  const [{ data: snippetRows }, { data: contactRows }, { data: readRows }] =
    await Promise.all([
      supabase.rpc("latest_thread_snippets", { p_thread_ids: threadIds }),
      participantAddresses.length > 0
        ? supabase.rpc("contacts_for", { p_addresses: participantAddresses })
        : Promise.resolve({ data: [] }),
      supabase.rpc("thread_reads_for", { p_thread_ids: threadIds }),
    ]);

  const snippetByThread = new Map<string, string>();
  for (const row of (snippetRows ?? []) as {
    thread_id: string;
    snippet: string | null;
  }[]) {
    if (!snippetByThread.has(row.thread_id)) {
      snippetByThread.set(row.thread_id, normalizeSnippet(row.snippet) ?? "");
    }
  }

  const nameByAddress = new Map<string, string | null>(
    ((contactRows ?? []) as { address: string; display_name: string | null }[]).map(
      (c) => [c.address, c.display_name],
    ),
  );
  const labelFor = (address: string) =>
    nameByAddress.get(address) || fallbackLabel(address) || address;

  const readWatermark = new Map<string, number>();
  for (const row of (readRows ?? []) as {
    thread_id: string;
    last_read_at: string;
  }[]) {
    readWatermark.set(row.thread_id, new Date(row.last_read_at).getTime());
  }

  const logoFor = (address: string, threadTab: ContactTab): string | null => {
    if (threadTab !== "company") return null;
    const domain = logoDomainFor(address);
    return domain ? brandLogoUrl(domain) : null;
  };

  const railThreads: RailThread[] = threads.map((t) => {
    const participants = t.participant_set ?? [];
    const primary = participants[0] ?? "";
    const seenUpTo = readWatermark.get(t.id) ?? 0;
    const unread = Boolean(
      t.last_message_at && new Date(t.last_message_at).getTime() > seenUpTo,
    );
    return {
      id: t.id,
      primaryAddress: primary,
      label: labelFor(primary),
      logoUrl: logoFor(primary, t.tab),
      extraParticipants: Math.max(0, participants.length - 1),
      participants,
      // `participants` already excludes the user, so this is exactly the set a
      // reaction would be sent to. A self-thread (no other participants) is
      // always reactable.
      canReact: participants.length === 0 || canReactTo(participants),
      snippet: snippetByThread.get(t.id) ?? "",
      lastMessageAt: t.last_message_at,
      unread,
    };
  });

  const last = threads[threads.length - 1];
  const nextCursor: Cursor | null =
    threads.length < PAGE_SIZE ? null : { lastMessageAt: last.last_message_at, id: last.id };

  return NextResponse.json({ threads: railThreads, nextCursor });
}
