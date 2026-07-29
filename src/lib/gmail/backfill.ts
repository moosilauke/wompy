import "server-only";
import { google, type gmail_v1 } from "googleapis";
import { getAuthorizedClient } from "@/lib/gmail/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { GMAIL_RETRY_OPTIONS } from "@/lib/gmail/quota";
import { mapMessageToRow, storeAttachments } from "@/lib/gmail/sync";
import {
  groupMessagesIntoThreads,
  type ThreadingResult,
} from "@/lib/email/threading";
import { extractAttachments } from "@/lib/email/attachments";
import { extractReaction } from "@/lib/email/reactions";
import {
  linkPendingReactions,
  storeReactions,
  type StoredReaction,
} from "@/lib/email/reaction-store";
import type { EmailAccount } from "@/lib/types";

/**
 * Historical sync: fetch one bounded, resumable chunk of a Gmail account's
 * past mail, older than what regular sync (syncAccount) has ever covered.
 *
 * Regular sync deliberately never backfills — its first watermark is "now" at
 * connect time (see sync.ts). This is the opposite direction: given a
 * `backfill_jobs` row bounding a date range (range_after..range_before) and a
 * possibly-null `page_token` left over from the last chunk, fetch exactly one
 * page of Gmail's list results, ingest those messages the same way syncAccount
 * does (reusing mapMessageToRow/storeAttachments so the row shape never
 * drifts), and persist progress so the next call resumes exactly where this
 * one left off.
 *
 * Deliberately chunked rather than looping until the whole range is done:
 * there is no background-job infrastructure in this codebase (no queue, no
 * Netlify Background Functions), and everything runs as a normal serverless
 * request with a real timeout. One page (PAGE_SIZE messages) comfortably fits
 * inside that budget; the caller (POST /api/backfill/step) is called
 * repeatedly by the client until the job reports `complete`.
 */

const PAGE_SIZE = 25;
// Fetched with bounded concurrency, not sequentially — Gmail has no batch
// fetch for message bodies (unlike batchModify), so throughput has to come
// from a small worker pool instead. Conservative relative to Gmail's ~250
// units/sec per-user quota (messages.get = 5 units, so 50/sec is the
// theoretical ceiling); this stays well under it even with sync/other
// concurrent activity on the same account.
const FETCH_CONCURRENCY = 5;

export type BackfillJobStatus = "pending" | "running" | "complete" | "failed";

export interface BackfillJobRow {
  id: string;
  user_id: string;
  email_account_id: string;
  status: BackfillJobStatus;
  range_after: string;
  range_before: string;
  page_token: string | null;
  messages_done: number;
  messages_estimated: number | null;
}

export interface BackfillStepResult {
  status: BackfillJobStatus;
  messagesDone: number;
  messagesEstimated: number | null;
  fetchedThisStep: number;
  /** Contacts/threads this chunk actually touched, so the caller can scope
   * classification to what changed instead of the whole mailbox — same
   * reasoning as SyncResult.threading in sync.ts. */
  threading: ThreadingResult;
}

/**
 * Process one chunk of a backfill job: list one page, fetch each message body
 * (bounded concurrency), upsert, thread, and persist the job's new cursor.
 *
 * Never throws on a Gmail-side failure mid-chunk — partial progress from
 * messages that did fetch is still saved, and the job's `last_error` records
 * what happened, so the client's next call just retries rather than losing
 * everything fetched so far. Only truly unrecoverable errors (e.g. reauth
 * required) propagate, matching syncAccount's existing behavior.
 */
export async function backfillAccount(
  account: EmailAccount,
  job: BackfillJobRow,
): Promise<BackfillStepResult> {
  const admin = createAdminClient();

  const emptyThreading: ThreadingResult = {
    threadsTouched: 0,
    messagesLinked: 0,
    contactsTouched: 0,
    threadIds: [],
    contactAddresses: [],
  };

  if (job.status === "complete") {
    return {
      status: "complete",
      messagesDone: job.messages_done,
      messagesEstimated: job.messages_estimated,
      fetchedThisStep: 0,
      threading: emptyThreading,
    };
  }

  // Atomically flips pending/failed -> running. If another concurrent call
  // already claimed this job (e.g. an overlapping client poll, a
  // double-click, a retried request), this returns no rows and the caller
  // treats it the same as "nothing to do right now" rather than two calls
  // racing to process the same page and clobbering each other's progress.
  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_backfill_job",
    { p_job_id: job.id },
  );
  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) {
    return {
      status: job.status,
      messagesDone: job.messages_done,
      messagesEstimated: job.messages_estimated,
      fetchedThisStep: 0,
      threading: emptyThreading,
    };
  }

  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  const afterEpoch = Math.floor(new Date(job.range_after).getTime() / 1000);
  const beforeEpoch = Math.floor(new Date(job.range_before).getTime() / 1000);
  // Same `in:anywhere` reasoning as syncAccount: Sent/archived mail is needed
  // for reply-reciprocity and the chat view's outbound bubbles.
  const query = `in:anywhere after:${afterEpoch} before:${beforeEpoch}`;

  let list: gmail_v1.Schema$ListMessagesResponse;
  try {
    list = (
      await gmail.users.messages.list(
        {
          userId: "me",
          q: query,
          maxResults: PAGE_SIZE,
          pageToken: job.page_token ?? undefined,
        },
        GMAIL_RETRY_OPTIONS,
      )
    ).data;
  } catch (err) {
    await admin.rpc("increment_backfill_progress", {
      p_job_id: job.id,
      p_messages_done_delta: 0,
      p_page_token: job.page_token,
      p_messages_estimated: job.messages_estimated,
      p_status: "failed" satisfies BackfillJobStatus,
      p_last_error: err instanceof Error ? err.message : "list_failed",
    });
    throw err;
  }

  const ids = (list.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  const nextPageToken = list.nextPageToken ?? null;
  // resultSizeEstimate is a rough, approximate count Gmail computes per
  // request — captured once from the job's first chunk and held steady
  // afterward, since a shifting denominator would make the progress bar look
  // like it's moving backward as later pages recompute their own estimate.
  const messagesEstimated =
    job.messages_estimated ?? list.resultSizeEstimate ?? null;

  // Fetch full message bodies with bounded concurrency rather than
  // syncAccount's sequential loop — this is the throughput difference that
  // makes a large backfill tractable in a reasonable number of chunk calls.
  const rows: ReturnType<typeof mapMessageToRow>[] = [];
  const attachmentsByGmailId = new Map<string, ReturnType<typeof extractAttachments>>();
  const reactions: StoredReaction[] = [];
  let lastFetchError: unknown = null;
  let messagesSkipped = 0;

  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= ids.length) return;
      const id = ids[i];
      try {
        const full = (
          await gmail.users.messages.get(
            { userId: "me", id, format: "full" },
            GMAIL_RETRY_OPTIONS,
          )
        ).data;
        const row = mapMessageToRow(account, full);

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
      } catch (err) {
        // One message failing to fetch (a transient error surviving the
        // retry options, or a genuinely malformed message) shouldn't sink the
        // whole chunk. It's permanently skipped, not retried later: the
        // page_token advances past this whole page once the chunk completes
        // regardless, so this id won't be seen again by this job. Recorded in
        // last_error/messagesSkipped so a skip is visible rather than silent,
        // even though nothing currently surfaces it to the user beyond that.
        lastFetchError = err;
        messagesSkipped += 1;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, ids.length) }, worker),
  );

  let upserted = 0;
  let threading: ThreadingResult = emptyThreading;
  if (rows.length > 0) {
    const { data: stored, error } = await admin
      .from("messages")
      .upsert(rows, { onConflict: "email_account_id,gmail_message_id" })
      .select(
        "id, gmail_message_id, from_address, to_addresses, cc_addresses, internal_date",
      );
    if (error) {
      await admin.rpc("increment_backfill_progress", {
        p_job_id: job.id,
        p_messages_done_delta: 0,
        p_page_token: job.page_token,
        p_messages_estimated: job.messages_estimated,
        p_status: "failed" satisfies BackfillJobStatus,
        p_last_error: error.message,
      });
      throw error;
    }
    upserted = stored?.length ?? rows.length;

    await storeAttachments(account.user_id, stored ?? [], attachmentsByGmailId);
    if (reactions.length > 0) await storeReactions(account.user_id, reactions);
    await linkPendingReactions(account.user_id);

    threading = await groupMessagesIntoThreads(
      account.user_id,
      account.email,
      (stored ?? []) as Parameters<typeof groupMessagesIntoThreads>[2],
    );
  }

  const done = nextPageToken === null;

  // messages_done = messages_done + upserted, computed in SQL rather than
  // read-then-write in JS — this is what actually closes the race the
  // claim above only narrows: even if this were somehow called twice for
  // the same job, the increment itself can't be lost.
  const { data: updated, error: updateError } = await admin.rpc(
    "increment_backfill_progress",
    {
      p_job_id: job.id,
      p_messages_done_delta: upserted,
      p_page_token: nextPageToken,
      p_messages_estimated: messagesEstimated,
      p_status: (done ? "complete" : "pending") satisfies BackfillJobStatus,
      p_last_error: lastFetchError
        ? `skipped ${messagesSkipped} message(s) in this chunk: ${
            lastFetchError instanceof Error ? lastFetchError.message : "fetch_failed"
          }`
        : null,
    },
  );
  if (updateError) throw updateError;

  const newMessagesDone =
    (updated?.[0] as { messages_done: number } | undefined)?.messages_done ??
    job.messages_done + upserted;

  return {
    status: done ? "complete" : "pending",
    messagesDone: newMessagesDone,
    messagesEstimated,
    fetchedThisStep: upserted,
    threading,
  };
}
