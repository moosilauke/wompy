import "server-only";
import { google, type gmail_v1 } from "googleapis";
import { getAuthorizedClient } from "@/lib/gmail/auth";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const query = `after:${afterEpoch}`;

  // 1. List message ids matching the query (paginated, capped).
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const list: gmail_v1.Schema$ListMessagesResponse = (
      await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: PAGE_SIZE,
        pageToken,
      })
    ).data;
    for (const m of list.messages ?? []) {
      if (m.id) ids.push(m.id);
    }
    pageToken = list.nextPageToken ?? undefined;
  } while (pageToken && ids.length < MAX_MESSAGES_PER_SYNC);

  const boundedIds = ids.slice(0, MAX_MESSAGES_PER_SYNC);

  // 2. Fetch each full message and map to a row.
  const rows = [];
  for (const id of boundedIds) {
    const full = (
      await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      })
    ).data;
    rows.push(mapMessageToRow(account, full));
  }

  // 3. Upsert (idempotent). Then advance the watermark.
  let upserted = 0;
  if (rows.length > 0) {
    const { error, count } = await admin
      .from("messages")
      .upsert(rows, {
        onConflict: "email_account_id,gmail_message_id",
        count: "exact",
      });
    if (error) throw error;
    upserted = count ?? rows.length;
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
  };
}

// ---------------------------------------------------------------------------
// Message -> row mapping
// ---------------------------------------------------------------------------

function mapMessageToRow(
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
    from_address: headers["from"] ?? null,
    to_addresses: splitAddresses(headers["to"]),
    cc_addresses: splitAddresses(headers["cc"]),
    subject: headers["subject"] ?? null,
    message_id_header: headers["message-id"] ?? null,
    in_reply_to: headers["in-reply-to"] ?? null,
    references_header: headers["references"] ?? null,
    snippet: msg.snippet ?? null,
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

function splitAddresses(value: string | undefined): string[] | null {
  if (!value) return null;
  return value
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
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
