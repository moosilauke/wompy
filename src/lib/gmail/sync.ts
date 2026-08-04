import "server-only";
import { google, type gmail_v1 } from "googleapis";
import { getAuthorizedClient } from "@/lib/gmail/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  groupMessagesIntoThreads,
  type ThreadingResult,
} from "@/lib/email/threading";
import { htmlToText, normalizeSnippet } from "@/lib/email/text";
import { stripLinkMarkers } from "@/lib/email/linkify";
import { buildExcerpt } from "@/lib/email/excerpt";
import { extractAttachments } from "@/lib/email/attachments";
import { extractReaction } from "@/lib/email/reactions";
import {
  linkPendingReactions,
  storeReactions,
  type StoredReaction,
} from "@/lib/email/reaction-store";
import { canonicalAddress, parseAddress } from "@/lib/email/addresses";
import {
  GMAIL_FETCH_CONCURRENCY,
  GMAIL_RETRY_OPTIONS,
} from "@/lib/gmail/quota";
import type { EmailAccount } from "@/lib/types";

/**
 * Raw Gmail sync (MVP build step 1). Polling only — no Pub/Sub, no backfill.
 * On the first sync we set a `since` watermark of "now" so nothing prior to the
 * connect is imported (plan non-goal: no history backfill). Subsequent syncs
 * pull messages newer than the last watermark.
 *
 * Writes only to `messages`, idempotent on (email_account_id, gmail_message_id).
 * Only handles provider='gmail' accounts; the /api/sync dispatcher filters.
 * Classification and threading happen in later sessions.
 */

const PAGE_SIZE = 50;
const MAX_MESSAGES_PER_SYNC = 200; // safety cap for the manual-trigger MVP

export interface SyncResult {
  fetched: number;
  upserted: number;
  since: string; // ISO watermark used for this run
  threading: ThreadingResult;
}

export async function syncAccount(account: EmailAccount): Promise<SyncResult> {
  const admin = createAdminClient();
  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  // Watermark: only fetch mail after the last sync (or after "now" on first run,
  // so we don't backfill history). Gmail's `after:` query takes epoch seconds.
  const sinceDate = account.last_synced_at
    ? new Date(account.last_synced_at)
    : new Date();
  const afterEpoch = Math.floor(sinceDate.getTime() / 1000);
  // `in:anywhere` makes Gmail include SENT (and archived) mail, which a default
  // search omits. We need sent mail for two reasons: the classifier's
  // reply-reciprocity rule ("if you ever replied, they're a Contact") can only
  // fire if replies are stored, and the chat view can't show your own side of a
  // conversation without them.
  //
  // `-in:drafts` excludes unsent drafts — a draft was never sent to anyone,
  // so it has no business appearing as an outgoing chat bubble. Confirmed via
  // a real account: a stale, never-sent draft reply (label DRAFT) synced in
  // alongside the actual SENT message for the same reply, rendering as two
  // bubbles for what was genuinely one send.
  const query = `in:anywhere -in:drafts after:${afterEpoch}`;

  // 1. List message ids matching the query (paginated, capped).
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const list: gmail_v1.Schema$ListMessagesResponse = (
      await gmail.users.messages.list(
        {
          userId: "me",
          q: query,
          maxResults: PAGE_SIZE,
          pageToken,
        },
        GMAIL_RETRY_OPTIONS,
      )
    ).data;
    for (const m of list.messages ?? []) {
      if (m.id) ids.push(m.id);
    }
    pageToken = list.nextPageToken ?? undefined;
  } while (pageToken && ids.length < MAX_MESSAGES_PER_SYNC);

  const listedIds = ids.slice(0, MAX_MESSAGES_PER_SYNC);

  // Skip the messages.get + parse path entirely for ids already stored — one
  // indexed query against a full fetch each. Ordinary syncs overlap heavily
  // with what's already stored (the `after:` watermark has second
  // granularity, so the boundary second re-lists), and this is what stops
  // those from costing a round-trip apiece. Same pre-filter backfill uses.
  //
  // Guarded on there being anything to check: the common case for a 2-minute
  // poll is an empty list, and querying for membership in an empty set is a
  // round-trip whose answer is already known.
  let boundedIds = listedIds;
  if (listedIds.length > 0) {
    const { data: existing } = await admin
      .from("messages")
      .select("gmail_message_id")
      .eq("email_account_id", account.id)
      .in("gmail_message_id", listedIds);
    const alreadyStored = new Set(
      ((existing ?? []) as { gmail_message_id: string }[]).map(
        (r) => r.gmail_message_id,
      ),
    );
    boundedIds = listedIds.filter((id) => !alreadyStored.has(id));
  }

  // 2. Fetch each full message and map to a row. Attachment metadata is kept
  //    alongside, keyed by Gmail id, so it can be attributed to the stored rows
  //    after the upsert assigns them ids.
  //
  //    Bounded concurrency rather than one at a time: Gmail has no batch fetch
  //    for message bodies, so up to MAX_MESSAGES_PER_SYNC sequential round-trips
  //    was the single largest cost in a sync. Backfill already worked this way;
  //    this is the same pool, sharing one concurrency constant so the combined
  //    quota load stays easy to reason about (see GMAIL_FETCH_CONCURRENCY).
  const rows: ReturnType<typeof mapMessageToRow>[] = [];
  const attachmentsByGmailId = new Map<
    string,
    ReturnType<typeof extractAttachments>
  >();
  const reactions: StoredReaction[] = [];

  let cursor = 0;
  async function fetchWorker() {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= boundedIds.length) return;
      const id = boundedIds[i];

      const full = (
        await gmail.users.messages.get(
          { userId: "me", id, format: "full" },
          GMAIL_RETRY_OPTIONS,
        )
      ).data;
      // Defensive: `-in:drafts` above should already exclude these, but a
      // draft was never actually sent to anyone, so it must never be stored as
      // a message regardless of how it was fetched — this guards against the
      // query filter behaving unexpectedly for some account/locale rather than
      // relying on it alone.
      if ((full.labelIds ?? []).includes("DRAFT")) continue;

      const row = mapMessageToRow(account, full);

      // A reaction is an ordinary email carrying a specially-typed part.
      // Recorded separately and flagged, so it renders as a badge on its
      // target rather than as a one-character reply in the conversation.
      const emoji = full.payload ? extractReaction(full.payload) : null;
      if (emoji) {
        reactions.push({
          gmailMessageId: id,
          targetMessageIdHeader: row.in_reply_to,
          fromAddress: row.from_address ?? "",
          emoji,
          reactedAt: row.internal_date,
        });
        row.is_reaction = true;
      }

      rows.push(row);

      const attachments = extractAttachments(full.payload ?? undefined);
      if (attachments.length > 0) attachmentsByGmailId.set(id, attachments);
    }
  }

  // Deliberately NOT swallowing per-message errors the way backfill does: a
  // backfill chunk permanently advances past its page, so skipping one bad
  // message there is the only way not to lose the rest. A sync's watermark
  // isn't advanced until it succeeds, so letting the error propagate means
  // the next poll simply retries — no message is lost by failing loudly.
  await Promise.all(
    Array.from(
      { length: Math.min(GMAIL_FETCH_CONCURRENCY, boundedIds.length) },
      fetchWorker,
    ),
  );

  // 3. Upsert (idempotent). Select the stored rows back so threading can key
  //    them without a second round-trip.
  let upserted = 0;
  let threading: ThreadingResult = {
    threadsTouched: 0,
    messagesLinked: 0,
    contactsTouched: 0,
    threadIds: [],
    contactAddresses: [],
  };

  if (rows.length > 0) {
    const { data: stored, error } = await admin
      .from("messages")
      .upsert(rows, { onConflict: "email_account_id,gmail_message_id" })
      .select(
        "id, gmail_message_id, from_address, to_addresses, cc_addresses, internal_date",
      );
    if (error) throw error;
    upserted = stored?.length ?? rows.length;

    await storeAttachments(account.user_id, stored ?? [], attachmentsByGmailId);

    // After the messages exist, so a reaction can resolve a target that arrived
    // in this same batch.
    if (reactions.length > 0) {
      await storeReactions(account.user_id, reactions);
    }
    // Attach any reaction whose target was synced later than the reaction was.
    await linkPendingReactions(account.user_id);

    // 4. Group into participant-set threads (MVP step 3). Runs inside sync so
    //    there's no separate trigger to remember.
    threading = await groupMessagesIntoThreads(
      account.user_id,
      account.email,
      (stored ?? []) as Parameters<typeof groupMessagesIntoThreads>[2],
    );
  }

  const nowIso = new Date().toISOString();
  await admin
    .from("email_accounts")
    .update({ last_synced_at: nowIso })
    .eq("id", account.id);

  return {
    fetched: rows.length,
    upserted,
    since: sinceDate.toISOString(),
    threading,
  };
}

/**
 * Persist attachment metadata for freshly-stored messages.
 *
 * Only metadata: Gmail keeps the bytes, and `gmail_attachment_id` fetches them
 * on demand. Failures are swallowed — a missing paperclip is worth far less
 * than the mail itself, so it must never fail a sync.
 *
 * Exported for reuse by backfill.ts — identical shape, same idempotent upsert.
 */
export async function storeAttachments(
  userId: string,
  stored: { id: string; gmail_message_id?: string | null }[],
  attachmentsByGmailId: Map<string, ReturnType<typeof extractAttachments>>,
): Promise<void> {
  if (attachmentsByGmailId.size === 0) return;

  const rows = [];
  for (const message of stored) {
    const gmailId = message.gmail_message_id;
    if (!gmailId) continue;
    for (const att of attachmentsByGmailId.get(gmailId) ?? []) {
      rows.push({
        user_id: userId,
        message_id: message.id,
        gmail_attachment_id: att.gmailAttachmentId,
        filename: att.filename,
        mime_type: att.mimeType,
        size_bytes: att.sizeBytes,
      });
    }
  }

  if (rows.length === 0) return;

  const admin = createAdminClient();
  const { error } = await admin
    .from("attachments")
    // Re-syncing a message re-derives the same attachments; the unique
    // constraint makes this a no-op rather than a duplicate.
    .upsert(rows, { onConflict: "message_id,filename,size_bytes" });

  if (error) {
    console.error("Failed to store attachment metadata:", error.message);
  }
}

// ---------------------------------------------------------------------------
// Message -> row mapping
// ---------------------------------------------------------------------------

/**
 * Fetch and store a single message by its Gmail id, then thread it.
 *
 * Used right after sending so the message appears immediately. The normal sync
 * can't be relied on here: its `after:` watermark has second granularity and is
 * exclusive, so a message sent within the same second as `last_synced_at` would
 * be skipped until something else arrived.
 */
export async function ingestMessageById(
  account: EmailAccount,
  gmailMessageId: string,
): Promise<void> {
  const admin = createAdminClient();
  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  const full = (
    await gmail.users.messages.get(
      {
        userId: "me",
        id: gmailMessageId,
        format: "full",
      },
      GMAIL_RETRY_OPTIONS,
    )
  ).data;

  const row = mapMessageToRow(account, full);

  // A reaction ingested here (e.g. our own, right after sending) must be
  // recognised and flagged, exactly as the full sync does — otherwise the
  // carrier renders as a plain message until the next poll reclassifies it.
  const emoji = full.payload ? extractReaction(full.payload) : null;
  if (emoji) row.is_reaction = true;

  const { data: stored, error } = await admin
    .from("messages")
    .upsert([row], {
      onConflict: "email_account_id,gmail_message_id",
    })
    .select(
      "id, gmail_message_id, from_address, to_addresses, cc_addresses, internal_date",
    );
  if (error) throw error;

  if (emoji) {
    await storeReactions(account.user_id, [
      {
        gmailMessageId,
        targetMessageIdHeader: row.in_reply_to,
        fromAddress: row.from_address ?? "",
        emoji,
        reactedAt: row.internal_date,
      },
    ]);
    await linkPendingReactions(account.user_id);
  }

  const attachments = extractAttachments(full.payload ?? undefined);
  if (attachments.length > 0) {
    await storeAttachments(
      account.user_id,
      stored ?? [],
      new Map([[gmailMessageId, attachments]]),
    );
  }

  await groupMessagesIntoThreads(
    account.user_id,
    account.email,
    (stored ?? []) as Parameters<typeof groupMessagesIntoThreads>[2],
  );
}

/**
 * The text a message should be searchable by: its own content, with quoted
 * history and signature removed.
 *
 * `buildExcerpt` is reused rather than reimplemented, but the full cleaned body
 * is taken (not the length-capped excerpt) — search should reach the end of a
 * long message even though a bubble does not show it.
 */
function searchTextFor(
  text: string | null,
  html: string | null,
): string | null {
  const source = text ?? (html ? htmlToText(html) : null);
  if (!source) return null;
  // Markers are stripped before indexing: they are a rendering concern, and
  // leaving them in would put private-use characters into tsvector and into
  // every search snippet shown to the user. The link's LABEL stays searchable
  // (its URL does not, which matches what someone would actually search for).
  return stripLinkMarkers(buildExcerpt(source).cleaned || source);
}

/** Exported for reuse by backfill.ts — same message shape, same mapping. */
export function mapMessageToRow(
  account: EmailAccount,
  msg: gmail_v1.Schema$Message,
) {
  const headers = indexHeaders(msg.payload?.headers ?? []);
  const { text, html } = extractBody(msg.payload);

  return {
    user_id: account.user_id,
    email_account_id: account.id,
    gmail_message_id: msg.id!,
    gmail_thread_id: msg.threadId ?? null,
    // Gmail's labels. Note SENT does NOT reliably mean "the user wrote this":
    // for mail between two accounts the user owns, Gmail returns SENT on the
    // inbound copy too. Authorship is decided by the From address instead.
    // These are kept for SPAM/TRASH, which are trustworthy.
    label_ids: msg.labelIds ?? [],
    // Mirror Gmail's TRASH label so trashing in either place agrees. `null`
    // when untrashed, which also restores a message trashed elsewhere.
    trashed_at: (msg.labelIds ?? []).includes("TRASH")
      ? new Date().toISOString()
      : null,
    from_address: headers["from"] ?? null,
    // Canonicalized bare sender address (dots/+tags normalized), so
    // classify-run.ts can scope its message read to one contact by an exact
    // match instead of re-parsing every row's raw From header. Kept alongside
    // from_address rather than replacing it — from_address is the source of
    // truth for display and the raw header, this is a derived lookup key.
    from_canonical: headers["from"]
      ? canonicalAddress(parseAddress(headers["from"])?.address ?? headers["from"])
      : null,
    to_addresses: splitAddresses(headers["to"]),
    cc_addresses: splitAddresses(headers["cc"]),
    subject: headers["subject"] ?? null,
    message_id_header: headers["message-id"] ?? null,
    in_reply_to: headers["in-reply-to"] ?? null,
    // Set by the caller when a reaction part is found; the conversation view
    // filters these out.
    is_reaction: false,
    references_header: headers["references"] ?? null,
    // Gmail returns snippets HTML-escaped (`YOU&#39;VE`); decode at ingest so
    // every consumer gets clean text.
    snippet: normalizeSnippet(msg.snippet),
    // Plain-text form for search.
    //
    // HTML-only mail (41% of the corpus) has no body_text, so without the
    // conversion it would be unsearchable except by its short snippet.
    //
    // Excerpted rather than raw: quoted history would otherwise make every
    // reply in a thread match terms only the original author wrote, so
    // searching your own words would surface other people's messages.
    // Signatures would likewise match every message a person ever sent.
    search_text: searchTextFor(text, html),
    body_text: text,
    body_html: html,
    internal_date: msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : null,
    // Full header map — includes List-Unsubscribe / Precedence for the
    // step-2 classifier.
    raw_headers: headers,
  };
}

/** Lowercase header names -> value (last wins). */
function indexHeaders(
  headers: gmail_v1.Schema$MessagePartHeader[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    if (h.name) out[h.name.toLowerCase()] = h.value ?? "";
  }
  return out;
}

/**
 * Split an address header into entries, respecting quoting.
 *
 * A plain `.split(",")` breaks on commas INSIDE quoted display names, which is
 * how `"Cosgrave, Dan" <dan@x.com>` became two entries — the first of them,
 * `"Cosgrave`, having no `@` at all and being stored as if it were an address.
 * "Lastname, Firstname" is a common convention in corporate mail, so this
 * wasn't rare: it produced 22 junk contacts in a single real mailbox.
 *
 * Commas within <angle brackets> are skipped for the same reason, though
 * they're far rarer.
 */
function splitAddresses(value: string | undefined): string[] | null {
  if (!value) return null;

  const entries: string[] = [];
  let current = "";
  let inQuotes = false;
  let inAngle = false;

  for (const ch of value) {
    if (ch === '"' && !inAngle) {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "<" && !inQuotes) {
      inAngle = true;
      current += ch;
    } else if (ch === ">" && !inQuotes) {
      inAngle = false;
      current += ch;
    } else if (ch === "," && !inQuotes && !inAngle) {
      const entry = current.trim();
      if (entry) entries.push(entry);
      current = "";
    } else {
      current += ch;
    }
  }

  const last = current.trim();
  if (last) entries.push(last);

  return entries.length > 0 ? entries : null;
}

/** Walk the MIME tree collecting the first text/plain and text/html parts. */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): {
  text: string | null;
  html: string | null;
} {
  if (!payload) return { text: null, html: null };

  let text: string | null = null;
  let html: string | null = null;

  const visit = (part: gmail_v1.Schema$MessagePart) => {
    const mime = part.mimeType ?? "";
    const data = part.body?.data;
    if (data) {
      if (mime === "text/plain" && text === null) text = decodeBase64Url(data);
      else if (mime === "text/html" && html === null) html = decodeBase64Url(data);
    }
    for (const child of part.parts ?? []) visit(child);
  };

  visit(payload);
  return { text, html };
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}
