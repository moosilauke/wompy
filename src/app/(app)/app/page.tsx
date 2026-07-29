import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import {
  canonicalAddress,
  fallbackLabel,
  parseAddress,
} from "@/lib/email/addresses";
import { htmlToText, normalizeSnippet } from "@/lib/email/text";
import { buildExcerpt } from "@/lib/email/excerpt";
import { canReactTo } from "@/lib/email/reactions";
import { brandLogoUrl, logoDomainFor } from "@/lib/email/logos";
import { AppShell } from "./AppShell";
import { type RailThread } from "./ContactRail";
import {
  ReadingPane,
  type PaneMessage,
  type PaneThread,
} from "./ReadingPane";
import { CompanyPane, type CompanyMessage } from "./CompanyPane";
import { MessageListPane, type ListedMessage } from "./MessageListPane";
import { ToastProvider } from "./Toasts";
import { OptimisticReactionsProvider } from "./OptimisticReactions";
import { MarkThreadRead } from "./MarkThreadRead";
import { isThreadView, type AppView, type ContactTab } from "@/lib/types";
import type { AttachmentInfo } from "@/components/ui/AttachmentChip";
import type { ReactionSummary } from "@/components/ui/ReactionBadges";

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
  // getClaims() verifies the JWT locally against cached JWKS; getUser() would
  // round-trip to the auth server (~120ms) on every render. The proxy has
  // already gated this route, so this is reading an established session rather
  // than authenticating from scratch.
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims;
  if (!user) redirect("/login");
  // Queries below are scoped by RLS rather than an explicit user_id filter, so
  // only the email (for the top bar) is read off the claims here.
  const userEmail = typeof user.email === "string" ? user.email : null;

  const params = await searchParams;
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const requestedThreadId = first(params.thread);
  const tabParam = first(params.tab);
  const activeTab: AppView =
    tabParam === "company" ||
    tabParam === "spam" ||
    tabParam === "sent" ||
    tabParam === "trash"
      ? tabParam
      : "contact";
  // Sent and Trash are message filters, not thread categories, so they skip the
  // rail/pane machinery entirely.
  const threadView: ContactTab = isThreadView(activeTab) ? activeTab : "contact";

  // Bounded per-tab page size for the rail's initial load. A tab with more
  // than this gets a "Load more" control (POST /api/rail/more) rather than
  // shipping everything — the previous unbounded "all threads" select and
  // the latest_thread_snippets RPC both silently truncated at PostgREST's
  // default 1000-row response cap once an account crossed that many threads
  // (confirmed on a real 1,516-thread backfilled account: mail after a
  // certain date just vanished from the rail, no error). Three tab-scoped
  // queries below replace that single unbounded one.
  const RAIL_PAGE_SIZE = 200;

  // These queries are independent of each other, so they go out together.
  // Run sequentially they cost ~1.3s of round-trips; in parallel, ~0.25s — the
  // page's dominant cost, since every sync ends in router.refresh().
  //
  // Only the per-thread message fetch below has to wait, because it depends on
  // which thread ends up selected.
  const [
    { data: accounts },
    { data: contactThreadRows },
    { data: companyThreadRows },
    { data: spamThreadRows },
    { count: contactTotal },
    { count: companyTotal },
    { count: spamTotal },
    { data: contactRows },
    { data: readRows },
    { data: profileRow },
    { count: sentCount },
    { count: trashCount },
  ] = await Promise.all([
    // Connected inbox addresses — used to decide which bubbles are "mine".
    supabase.from("email_accounts").select("email, last_synced_at"),
    // The rail's initial page, per tab — newest activity first, bounded, with
    // `id` as a tiebreaker so "Load more" (keyset pagination on
    // last_message_at + id) has a stable cursor even when several threads
    // share the same timestamp.
    supabase
      .from("threads")
      .select("id, participant_set, last_message_at, tab")
      .eq("tab", "contact")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(RAIL_PAGE_SIZE),
    supabase
      .from("threads")
      .select("id, participant_set, last_message_at, tab")
      .eq("tab", "company")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(RAIL_PAGE_SIZE),
    supabase
      .from("threads")
      .select("id, participant_set, last_message_at, tab")
      .eq("tab", "spam")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(RAIL_PAGE_SIZE),
    // True per-tab totals, independent of the page above — badges must never
    // silently undercount just because only the first page was fetched.
    supabase
      .from("threads")
      .select("id", { count: "exact", head: true })
      .eq("tab", "contact"),
    supabase
      .from("threads")
      .select("id", { count: "exact", head: true })
      .eq("tab", "company"),
    supabase
      .from("threads")
      .select("id", { count: "exact", head: true })
      .eq("tab", "spam"),
    // Display names for participants, gathered during threading.
    supabase.from("contacts").select("address, display_name, tab"),
    // Per-thread read watermarks. Unread is derived by comparing these to each
    // thread's last_message_at — no Gmail round-trip, and it follows the user
    // across devices.
    supabase.from("thread_reads").select("thread_id, last_read_at"),
    // The user's own profile — only to decide whether the Admin menu item
    // exists. RLS lets them read their own row; the panel itself re-verifies.
    supabase.from("profiles").select("is_admin").maybeSingle(),
    // Counts only — head:true skips returning the rows themselves, since these
    // just drive the badges in the More menu.
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .contains("label_ids", ["SENT"])
      .is("trashed_at", null),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .not("trashed_at", "is", null),
  ]);

  const threadRows = [
    ...(contactThreadRows ?? []),
    ...(companyThreadRows ?? []),
    ...(spamThreadRows ?? []),
  ];

  // Snippets only for the specific threads actually being rendered this page
  // — not the whole mailbox. Skipped entirely when there's nothing to look
  // up (a brand-new account with zero threads yet).
  const { data: recentRows } =
    threadRows.length > 0
      ? await supabase.rpc("latest_thread_snippets", {
          p_thread_ids: threadRows.map((t) => t.id),
        })
      : { data: [] };

  // Canonicalized so `Kevincole@`, `kevin.cole@`, and `kevincole+tag@` all match
  // the connected account.
  const accountRows = (accounts ?? []) as {
    email: string;
    last_synced_at: string | null;
  }[];
  const selfAddresses = new Set(
    accountRows.map((a) => canonicalAddress(a.email)),
  );

  // The most recent sync across connected accounts, seeding the menu's "last
  // synced" tooltip. The client updates it live after each sync.
  const lastSyncedAt =
    accountRows
      .map((a) => a.last_synced_at)
      .filter((t): t is string => Boolean(t))
      .sort()
      .at(-1) ?? null;

  const snippetByThread = new Map<string, string>();
  for (const row of (recentRows ?? []) as {
    thread_id: string;
    snippet: string | null;
  }[]) {
    if (!snippetByThread.has(row.thread_id)) {
      // Decoded here as well as at ingest, so rows synced before the fix (and
      // any provider that escapes differently) still render clean text.
      snippetByThread.set(row.thread_id, normalizeSnippet(row.snippet) ?? "");
    }
  }

  // Wompy-native read state: a thread is unread when its newest message is
  // newer than the user's read watermark for it. No watermark row means read —
  // the cutover seeded every existing thread, so an unseeded thread is one
  // created after the switch by incoming mail, which the comparison below still
  // catches because its last_message_at beats the absent (epoch) watermark.
  const readWatermark = new Map<string, number>();
  for (const row of (readRows ?? []) as {
    thread_id: string;
    last_read_at: string;
  }[]) {
    readWatermark.set(row.thread_id, new Date(row.last_read_at).getTime());
  }
  const unreadThreads = new Set<string>();
  for (const t of (threadRows ?? []) as {
    id: string;
    last_message_at: string | null;
  }[]) {
    if (!t.last_message_at) continue;
    const seenUpTo = readWatermark.get(t.id) ?? 0;
    if (new Date(t.last_message_at).getTime() > seenUpTo) {
      unreadThreads.add(t.id);
    }
  }

  const allThreads = ((threadRows ?? []) as {
    id: string;
    participant_set: string[];
    last_message_at: string | null;
    tab: ContactTab;
  }[]).filter((t) => snippetByThread.has(t.id));

  // Real per-tab totals (contactTotal/companyTotal/spamTotal), not derived
  // from whatever page happened to be fetched — a badge must reflect the
  // true count even when the rail itself only holds the first page and the
  // rest is behind "Load more". Sent and Trash count messages rather than
  // threads, since that is what those views list.
  const counts: Record<AppView, number> = {
    contact: contactTotal ?? 0,
    company: companyTotal ?? 0,
    spam: spamTotal ?? 0,
    sent: sentCount ?? 0,
    trash: trashCount ?? 0,
  };

  const nameByAddress = new Map<string, string | null>(
    (contactRows ?? []).map((c) => {
      const row = c as { address: string; display_name: string | null };
      return [row.address, row.display_name];
    }),
  );

  // A stored display name wins; otherwise derive something readable, which for
  // a functional address like no-reply@sentinelone.com means the organization
  // rather than the literal "no-reply".
  const labelFor = (address: string) =>
    nameByAddress.get(address) || fallbackLabel(address) || address;

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
      label: c.display_name || fallbackLabel(c.address) || c.address,
    }));

  // A Brandfetch logo, but only for Company senders on a confident brand
  // domain — never people, never spam, never an ESP domain. Returns null
  // everywhere else, and the Avatar falls back to initials.
  const logoFor = (address: string, tab: ContactTab): string | null => {
    if (tab !== "company") return null;
    const domain = logoDomainFor(address);
    return domain ? brandLogoUrl(domain) : null;
  };

  const toRailThread = (
    t: (typeof allThreads)[number],
  ): RailThread => {
    const participants = t.participant_set ?? [];
    const primary = participants[0] ?? "";
    return {
      id: t.id,
      primaryAddress: primary,
      label: labelFor(primary),
      logoUrl: logoFor(primary, t.tab),
      extraParticipants: Math.max(0, participants.length - 1),
      snippet: snippetByThread.get(t.id) ?? "",
      lastMessageAt: t.last_message_at,
      // The real unread state, open thread included. The open thread is NOT
      // suppressed: marking it unread while reading it is a deliberate "later"
      // gesture whose whole point is that the dot stays. Opening an unread
      // thread still clears the dot promptly — MarkThreadRead fires on arrival
      // and refreshes — so the only case where it lingers is the one where the
      // user asked for it to.
      unread: unreadThreads.has(t.id),
    };
  };

  // Rail data for every tab, not just the active one — each tab's first page
  // (RAIL_PAGE_SIZE threads) was already fetched above, so sending all three
  // lists costs one extra pass over data already in memory, and lets the
  // client switch tabs without a server round-trip. Previously a tab switch
  // re-fetched identical data just to filter it differently.
  const threads = allThreads.filter((t) => t.tab === threadView);

  // Resolve the selected thread (default: most recent). Done before the rail is
  // built so the open conversation can be excluded from the unread treatment —
  // with no `?thread=`, the first thread is still the one being read.
  let selected =
    threads.find((t) => t.id === requestedThreadId) ?? threads[0] ?? null;

  // A requested thread outside the current page (e.g. a bookmarked link to
  // an older, backfilled conversation past RAIL_PAGE_SIZE) would otherwise
  // silently fall through to threads[0] above — opening the wrong
  // conversation with no indication anything was off. Fetched directly by
  // id (RLS still scopes it to the current user) rather than widening the
  // page fetch itself, since this is the rare "deep link to something old"
  // case, not the common path.
  //
  // Known minor gap: unreadThreads (below) is only computed for the current
  // page, so MarkThreadRead won't correctly detect this thread as unread if
  // it's both out-of-page and genuinely unread — it just won't get
  // auto-marked-read on this visit. Accepted rather than fetching its
  // thread_reads watermark too, since the failure mode is harmless (stays
  // unread a little longer) and the case is already rare.
  if (requestedThreadId && selected?.id !== requestedThreadId) {
    const { data: directThread } = await supabase
      .from("threads")
      .select("id, participant_set, last_message_at, tab")
      .eq("id", requestedThreadId)
      .maybeSingle();
    if (directThread) {
      selected = directThread as (typeof allThreads)[number];
      if (!snippetByThread.has(directThread.id)) {
        const { data: directSnippet } = await supabase.rpc(
          "latest_thread_snippets",
          { p_thread_ids: [directThread.id] },
        );
        const row = (directSnippet ?? [])[0] as
          | { thread_id: string; snippet: string | null }
          | undefined;
        if (row) {
          snippetByThread.set(row.thread_id, normalizeSnippet(row.snippet) ?? "");
        }
      }
    }
  }

  const railByTab: Record<ContactTab, RailThread[]> = {
    contact: allThreads
      .filter((t) => t.tab === "contact")
      .map(toRailThread),
    company: allThreads
      .filter((t) => t.tab === "company")
      .map(toRailThread),
    spam: allThreads
      .filter((t) => t.tab === "spam")
      .map(toRailThread),
  };

  // "Load more" cursor per tab, derived from the raw fetched page (not
  // allThreads, which is further filtered down to threads with visible
  // content) — the cursor has to reflect exactly where the underlying fetch
  // left off, regardless of whether every fetched row ended up rendered.
  // Fewer rows than RAIL_PAGE_SIZE came back means that tab's whole table
  // was already exhausted — no further page exists, so the cursor is null.
  const cursorFor = (
    rows: { id: string; last_message_at: string | null }[] | null,
  ): { lastMessageAt: string | null; id: string } | null => {
    const list = rows ?? [];
    if (list.length < RAIL_PAGE_SIZE) return null;
    const last = list[list.length - 1];
    return { lastMessageAt: last.last_message_at, id: last.id };
  };
  const initialCursors: Record<ContactTab, { lastMessageAt: string | null; id: string } | null> = {
    contact: cursorFor(contactThreadRows),
    company: cursorFor(companyThreadRows),
    spam: cursorFor(spamThreadRows),
  };

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
      // Whether the add-reaction control is offered. `participants` already
      // excludes the user (participant-set threading), so this is exactly the
      // set a reaction would be sent to. A self-thread (no other participants)
      // is always reactable.
      canReact:
        participants.length === 0 || canReactTo(participants),
      logoUrl: logoFor(primary, selected.tab),
    };

    const { data: messageRows } = await supabase
      .from("messages")
      .select(
        "id, from_address, subject, body_text, body_html, snippet, internal_date, label_ids",
      )
      .eq("thread_id", selected.id)
      .is("trashed_at", null)
      // Reactions render as badges on their target, not as their own bubbles.
      .eq("is_reaction", false)
      // Fetched newest-first so the limit keeps the most RECENT messages, then
      // reversed below for display. Ordering ascending here would silently take
      // the oldest 200 of a long conversation.
      .order("internal_date", { ascending: false })
      .limit(200);

    // Attachments for exactly the messages being rendered — one extra query
    // rather than a join, so the message fetch stays narrow.
    const messageIds = ((messageRows ?? []) as { id: string }[]).map(
      (m) => m.id,
    );
    const [{ data: attachmentRows }, { data: reactionRows }] =
      messageIds.length > 0
        ? await Promise.all([
            supabase
              .from("attachments")
              .select("id, message_id, filename, mime_type, size_bytes")
              .in("message_id", messageIds),
            supabase
              .from("reactions")
              .select("id, message_id, emoji, from_address")
              .in("message_id", messageIds),
          ])
        : [{ data: [] }, { data: [] }];

    // Grouped by target and collapsed by emoji, so three thumbs-up render as
    // one badge with a count rather than three identical badges.
    const reactionsByMessage = new Map<string, ReactionSummary[]>();
    for (const row of (reactionRows ?? []) as {
      message_id: string;
      emoji: string;
      from_address: string;
    }[]) {
      const list = reactionsByMessage.get(row.message_id) ?? [];
      const existing = list.find((r) => r.emoji === row.emoji);
      const who = parseAddress(row.from_address);
      const name = who?.displayName || who?.address || "someone";
      if (existing) {
        existing.count += 1;
        existing.people.push(name);
      } else {
        list.push({ emoji: row.emoji, count: 1, people: [name] });
      }
      reactionsByMessage.set(row.message_id, list);
    }

    const attachmentsByMessage = new Map<string, AttachmentInfo[]>();
    for (const row of (attachmentRows ?? []) as {
      id: string;
      message_id: string;
      filename: string;
      mime_type: string | null;
      size_bytes: number | null;
    }[]) {
      const list = attachmentsByMessage.get(row.message_id) ?? [];
      list.push({
        id: row.id,
        filename: row.filename,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
      });
      attachmentsByMessage.set(row.message_id, list);
    }

    const rows = ((messageRows ?? []) as {
      id: string;
      from_address: string | null;
      subject: string | null;
      body_text: string | null;
      body_html: string | null;
      snippet: string | null;
      internal_date: string | null;
      label_ids: string[] | null;
    }[])
      // Chronological for display: oldest first, newest at the bottom. Both
      // views read the same way — a conversation runs down the page, and the
      // most recent message is where you land.
      .reverse();

    // Excerpting runs on the server so the client never receives the quoted
    // history and signatures it isn't going to show.
    if (threadView === "contact") {
      paneMessages = rows.map((m) => {
        const from = parseAddress(m.from_address);
        // HTML-only mail (42% of the corpus) is converted to text rather than
        // sanitized and injected: the chat view renders prose, and this keeps
        // `body_html` out of the DOM entirely — no XSS surface, no remote image
        // loads signalling that mail was opened.
        const source =
          m.body_text ||
          (m.body_html ? htmlToText(m.body_html) : null) ||
          normalizeSnippet(m.snippet);
        const excerpt = buildExcerpt(source);
        return {
          id: m.id,
          // The From address is the only reliable signal for "did I write this".
          // Gmail's SENT label is deliberately NOT consulted: when you correspond
          // with your own other accounts, it returns SENT on inbound messages
          // too, which made every bubble render as outgoing.
          outgoing: from ? selfAddresses.has(canonicalAddress(from.address)) : false,
          body: excerpt.text,
          fullBody: excerpt.full,
          truncated: excerpt.truncated,
          // Only flagged when conversion produced nothing readable — otherwise the
          // text above is the message, and a "preview only" note would be wrong.
          htmlOnly: !m.body_text && !!m.body_html && !excerpt.text,
          attachments: attachmentsByMessage.get(m.id) ?? [],
          reactions: reactionsByMessage.get(m.id) ?? [],
          sentAt: m.internal_date,
        };
      });
    } else {
      companyMessages = rows.map((m) => {
        // HTML-only mail (42% of the corpus) is converted to text rather than
        // sanitized and injected: the chat view renders prose, and this keeps
        // `body_html` out of the DOM entirely — no XSS surface, no remote image
        // loads signalling that mail was opened.
        const source =
          m.body_text ||
          (m.body_html ? htmlToText(m.body_html) : null) ||
          normalizeSnippet(m.snippet);
        const excerpt = buildExcerpt(source);
        return {
          id: m.id,
          subject: m.subject,
          body: excerpt.text,
          fullBody: excerpt.full,
          truncated: excerpt.truncated,
          // Only flagged when conversion produced nothing readable — otherwise the
          // text above is the message, and a "preview only" note would be wrong.
          htmlOnly: !m.body_text && !!m.body_html && !excerpt.text,
          attachments: attachmentsByMessage.get(m.id) ?? [],
          reactions: reactionsByMessage.get(m.id) ?? [],
          sentAt: m.internal_date,
        };
      });
    }
  }

  // Sent and Trash: a flat list of messages, independent of thread selection.
  let listedMessages: ListedMessage[] = [];
  if (activeTab === "sent" || activeTab === "trash") {
    const base = supabase
      .from("messages")
      .select(
        "id, thread_id, from_address, to_addresses, subject, snippet, internal_date",
      )
      .order("internal_date", { ascending: false })
      .limit(100);

    const { data: listRows } =
      activeTab === "sent"
        ? await base.contains("label_ids", ["SENT"]).is("trashed_at", null)
        : await base.not("trashed_at", "is", null);

    // Looked up directly rather than reused from the rail's threadRows —
    // those are now only the first RAIL_PAGE_SIZE threads per tab, and a
    // Sent/Trash message can easily belong to a thread outside that page
    // (e.g. an old conversation the user replied to once, then never
    // touched again). Scoped to exactly the thread ids these messages
    // reference, so it stays cheap regardless of total thread count.
    const listedThreadIds = [
      ...new Set(
        ((listRows ?? []) as { thread_id: string | null }[])
          .map((m) => m.thread_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const { data: listedThreadTabs } =
      listedThreadIds.length > 0
        ? await supabase
            .from("threads")
            .select("id, tab")
            .in("id", listedThreadIds)
        : { data: [] };
    const tabByThread = new Map(
      ((listedThreadTabs ?? []) as { id: string; tab: ContactTab }[]).map(
        (t) => [t.id, t.tab],
      ),
    );

    listedMessages = ((listRows ?? []) as {
      id: string;
      thread_id: string | null;
      from_address: string | null;
      to_addresses: string[] | null;
      subject: string | null;
      snippet: string | null;
      internal_date: string | null;
    }[]).map((m) => {
      // Sent mail is identified by its recipient, received mail by its sender —
      // "from me" on every row of Sent would carry no information.
      const counterpart =
        activeTab === "sent"
          ? parseAddress(m.to_addresses?.[0] ?? null)
          : parseAddress(m.from_address);
      const address = counterpart?.address ?? "";
      return {
        id: m.id,
        threadId: m.thread_id,
        threadTab: m.thread_id ? tabByThread.get(m.thread_id) ?? null : null,
        personLabel:
          counterpart?.displayName || labelFor(address) || "(unknown)",
        personAddress: address,
        subject: m.subject,
        preview: normalizeSnippet(m.snippet) ?? "",
        sentAt: m.internal_date,
      };
    });
  }

  return (
    <ToastProvider>
      <OptimisticReactionsProvider>
      {/* Renders nothing; fires the mark-read request for the open thread. */}
      {selected && (
        <MarkThreadRead
          threadId={selected.id}
          hasUnread={unreadThreads.has(selected.id)}
        />
      )}
      <AppShell
        userEmail={userEmail}
        isAdmin={Boolean((profileRow as { is_admin: boolean } | null)?.is_admin)}
        lastSyncedAt={lastSyncedAt}
        initialTab={activeTab}
        counts={counts}
        railByTab={railByTab}
        initialCursors={initialCursors}
        selectedId={selected?.id ?? null}
        contactSuggestions={contactSuggestions}
      >
        {/* Sent and Trash cut across threads, so they replace the pane with a
            flat list. Spam uses the classic list view — you skim it for false
            positives, you don't hold conversations in it. */}
        {activeTab === "sent" || activeTab === "trash" ? (
          <MessageListPane view={activeTab} messages={listedMessages} />
        ) : activeTab === "contact" ? (
          <ReadingPane thread={paneThread} messages={paneMessages} />
        ) : (
          <CompanyPane
            thread={paneThread}
            messages={companyMessages}
            isSpam={activeTab === "spam"}
          />
        )}
      </AppShell>
      </OptimisticReactionsProvider>
    </ToastProvider>
  );
}
