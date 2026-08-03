import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalAddress, parseAddress } from "@/lib/email/addresses";
import { htmlToText, normalizeSnippet } from "@/lib/email/text";
import { buildExcerpt } from "@/lib/email/excerpt";
import type { AttachmentInfo } from "@/components/ui/AttachmentChip";
import type { ReactionSummary } from "@/components/ui/ReactionBadges";

/**
 * Loading and mapping the messages of one open conversation.
 *
 * Extracted from the app page because a conversation is now opened two ways —
 * a cold page load (server-rendered, deep link, back/forward) and a client
 * fetch through /api/thread/[id] when a rail row is clicked. Both must produce
 * byte-identical panes; two copies of this mapping would drift, and the ways
 * they'd drift are exactly the ones that matter (what counts as outgoing,
 * whether an excerpt was truncated, whether body_html ever reaches the client).
 *
 * The security property this is responsible for: `body_html` is untrusted
 * remote content and never leaves the server. It's converted to text here, so
 * the client receives prose — no XSS surface, and no remote image loads
 * signalling that mail was opened.
 */

/** Newest N kept, since a conversation is read from its most recent end. */
export const PANE_MESSAGE_LIMIT = 200;

/** Shape both panes share; the two views pick different fields off it. */
interface MappedMessage {
  id: string;
  /** Lets an optimistic bubble recognize its own message when it lands. */
  gmailMessageId: string | null;
  outgoing: boolean;
  subject: string | null;
  body: string | null;
  fullBody: string;
  truncated: boolean;
  htmlOnly: boolean;
  attachments: AttachmentInfo[];
  reactions: ReactionSummary[];
  sentAt: string | null;
}

interface MessageRow {
  id: string;
  gmail_message_id: string | null;
  from_address: string | null;
  subject: string | null;
  body_text: string | null;
  snippet: string | null;
  internal_date: string | null;
}

/**
 * Fetch and map every message of a thread, ready for either pane.
 *
 * `selfAddresses` must already be canonicalized — it decides which bubbles
 * render as outgoing, and the caller has it to hand from the account list.
 */
export async function loadPaneMessages(
  supabase: SupabaseClient,
  threadId: string,
  selfAddresses: Set<string>,
): Promise<MappedMessage[]> {
  // body_html is deliberately NOT selected here. It's ~91% of the bytes in a
  // thread and is only needed for messages with no body_text (~28% of the
  // corpus) — selecting it unconditionally meant fetching hundreds of MB
  // across a mailbox purely to throw it away. The rows that actually need it
  // are fetched separately below.
  const { data: messageRows } = await supabase
    .from("messages")
    .select(
      "id, gmail_message_id, from_address, subject, body_text, snippet, internal_date",
    )
    .eq("thread_id", threadId)
    .is("trashed_at", null)
    // Reactions render as badges on their target, not as their own bubbles.
    .eq("is_reaction", false)
    // Fetched newest-first so the limit keeps the most RECENT messages, then
    // reversed below for display. Ordering ascending here would silently take
    // the oldest N of a long conversation.
    .order("internal_date", { ascending: false })
    .limit(PANE_MESSAGE_LIMIT);

  const rows = (messageRows ?? []) as MessageRow[];
  if (rows.length === 0) return [];

  const messageIds = rows.map((m) => m.id);
  // Only the messages that have no plain-text body need their HTML pulled.
  const htmlNeededIds = rows.filter((m) => !m.body_text).map((m) => m.id);

  const [
    { data: attachmentRows },
    { data: reactionRows },
    { data: htmlRows },
  ] = await Promise.all([
    // Attachments for exactly the messages being rendered — one extra query
    // rather than a join, so the message fetch stays narrow.
    supabase
      .from("attachments")
      .select("id, message_id, filename, mime_type, size_bytes")
      .in("message_id", messageIds),
    supabase
      .from("reactions")
      .select("id, message_id, emoji, from_address")
      .in("message_id", messageIds),
    htmlNeededIds.length > 0
      ? supabase.from("messages").select("id, body_html").in("id", htmlNeededIds)
      : Promise.resolve({ data: [] as { id: string; body_html: string | null }[] }),
  ]);

  const htmlById = new Map(
    ((htmlRows ?? []) as { id: string; body_html: string | null }[]).map((r) => [
      r.id,
      r.body_html,
    ]),
  );

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

  // Chronological for display: oldest first, newest at the bottom. Both views
  // read the same way — a conversation runs down the page, and the most recent
  // message is where you land.
  return rows.reverse().map((m) => {
    const from = parseAddress(m.from_address);
    const bodyHtml = m.body_text ? null : (htmlById.get(m.id) ?? null);
    // HTML-only mail is converted to text rather than sanitized and injected:
    // the chat view renders prose, and this keeps `body_html` out of the DOM
    // entirely — no XSS surface, no remote image loads signalling that mail
    // was opened.
    const source =
      m.body_text ||
      (bodyHtml ? htmlToText(bodyHtml) : null) ||
      normalizeSnippet(m.snippet);
    const excerpt = buildExcerpt(source);

    return {
      id: m.id,
      gmailMessageId: m.gmail_message_id,
      // The From address is the only reliable signal for "did I write this".
      // Gmail's SENT label is deliberately NOT consulted: when you correspond
      // with your own other accounts, it returns SENT on inbound messages too,
      // which made every bubble render as outgoing.
      outgoing: from ? selfAddresses.has(canonicalAddress(from.address)) : false,
      subject: m.subject,
      body: excerpt.text,
      fullBody: excerpt.full,
      truncated: excerpt.truncated,
      // Only flagged when conversion produced nothing readable — otherwise the
      // text above is the message, and a "preview only" note would be wrong.
      htmlOnly: !m.body_text && !!bodyHtml && !excerpt.text,
      attachments: attachmentsByMessage.get(m.id) ?? [],
      reactions: reactionsByMessage.get(m.id) ?? [],
      sentAt: m.internal_date,
    };
  });
}
