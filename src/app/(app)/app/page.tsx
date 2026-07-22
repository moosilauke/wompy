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

  // These four queries are independent of each other, so they go out together.
  // Run sequentially they cost ~1.3s of round-trips; in parallel, ~0.25s — the
  // page's dominant cost, since every sync ends in router.refresh().
  //
  // Only the per-thread message fetch below has to wait, because it depends on
  // which thread ends up selected.
  const [
    { data: accounts },
    { data: recentRows },
    { data: threadRows },
    { data: contactRows },
    { data: readRows },
    { data: profileRow },
    { count: sentCount },
    { count: trashCount },
  ] = await Promise.all([
    // Connected inbox addresses — used to decide which bubbles are "mine".
    supabase.from("email_accounts").select("email"),
    // Latest surviving message per thread. This decides which threads exist at
    // all: deleting the last message in a conversation must remove it from the
    // rail rather than leave an empty row. `trashed_at is null` does that.
    //
    // `body_text` is deliberately not selected — it was 49KB across these rows
    // and is only ever used as a snippet fallback, truncated to a preview.
    // `snippet` alone covers that, and Gmail populates it for every message.
    supabase
      .from("messages")
      .select("thread_id, snippet, internal_date")
      .not("thread_id", "is", null)
      .is("trashed_at", null)
      // Reaction carriers aren't messages: previewing one would make the rail
      // show a bare emoji as the conversation's latest content.
      .eq("is_reaction", false)
      .order("internal_date", { ascending: false })
      .limit(400),
    // All threads, newest activity first. Fetched whole so the tab counts are
    // accurate without a second round-trip.
    supabase
      .from("threads")
      .select("id, participant_set, last_message_at, tab")
      .order("last_message_at", { ascending: false, nullsFirst: false }),
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

  // Canonicalized so `Kevincole@`, `kevin.cole@`, and `kevincole+tag@` all match
  // the connected account.
  const selfAddresses = new Set(
    (accounts ?? []).map((a) =>
      canonicalAddress((a as { email: string }).email),
    ),
  );

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

  // Counts are derived from the same filtered list, so a tab badge never
  // promises conversations the rail won't show. Sent and Trash count messages
  // rather than threads, since that is what those views list.
  const counts: Record<AppView, number> = {
    contact: allThreads.filter((t) => t.tab === "contact").length,
    company: allThreads.filter((t) => t.tab === "company").length,
    spam: allThreads.filter((t) => t.tab === "spam").length,
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

  // Rail data for every tab, not just the active one.
  //
  // The server already loads all threads on each render (the tab counts need
  // them), so sending all three lists costs one extra pass over data we hold
  // anyway — and lets the client switch tabs without a server round-trip.
  // Previously a tab switch re-fetched identical data just to filter it
  // differently.
  const threads = allThreads.filter((t) => t.tab === threadView);

  // Resolve the selected thread (default: most recent). Done before the rail is
  // built so the open conversation can be excluded from the unread treatment —
  // with no `?thread=`, the first thread is still the one being read.
  const selected =
    threads.find((t) => t.id === requestedThreadId) ?? threads[0] ?? null;

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

    const tabByThread = new Map(
      ((threadRows ?? []) as { id: string; tab: ContactTab }[]).map((t) => [
        t.id,
        t.tab,
      ]),
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
        initialTab={activeTab}
        counts={counts}
        railByTab={railByTab}
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
