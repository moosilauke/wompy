import "server-only";
import { google, type gmail_v1 } from "googleapis";
import { getAuthorizedClient } from "@/lib/gmail/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  GMAIL_FETCH_CONCURRENCY,
  GMAIL_RETRY_OPTIONS,
} from "@/lib/gmail/quota";
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

const PAGE_SIZE = 50;
// Shared with regular sync (see GMAIL_FETCH_CONCURRENCY) so the two jobs'
// combined quota load is defined in one place — they can and do run at the
// same time. Was defined here first, when backfill was the only thing that
// fetched concurrently.
const FETCH_CONCURRENCY = GMAIL_FETCH_CONCURRENCY;

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

/** Default backfill window: 12 months back from connect time. Bounded
 * deliberately — see HISTORICAL_SYNC_PLAN.md — rather than "everything," so
 * first-run time is proportional for every user regardless of mailbox size.
 * Reachable further back later via the Settings "go back further" control
 * (Phase 5), which just widens this same job's range_after. */
const DEFAULT_BACKFILL_MONTHS = 12;

/**
 * Seed a `backfill_jobs` row for a newly connected Gmail account.
 *
 * Called from both OAuth callbacks right after the account's tokens are
 * upserted — before any actual fetching happens. The client-driven
 * `/api/backfill/step` loop picks up from here; this function only creates
 * the row, it doesn't fetch anything itself, so it's safe to call from a
 * redirect-bound callback without blocking on Gmail.
 *
 * `range_before` matches syncAccount's own "now" watermark at connect time
 * (see sync.ts) — mail after that point is regular sync's job, not
 * backfill's, so the two never re-fetch the same range.
 *
 * No-ops (returns without writing) if a job already exists for this account
 * — reconnecting shouldn't reset progress or silently restart a completed
 * backfill.
 */
export async function seedBackfillJob(
  userId: string,
  emailAccountId: string,
): Promise<void> {
  const admin = createAdminClient();

  const { data: existing, error: existingError } = await admin
    .from("backfill_jobs")
    .select("id")
    .eq("email_account_id", emailAccountId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return;

  const rangeBefore = new Date();
  const rangeAfter = new Date(rangeBefore);
  rangeAfter.setMonth(rangeAfter.getMonth() - DEFAULT_BACKFILL_MONTHS);

  const { error } = await admin.from("backfill_jobs").insert({
    user_id: userId,
    email_account_id: emailAccountId,
    status: "pending" satisfies BackfillJobStatus,
    range_after: rangeAfter.toISOString(),
    range_before: rangeBefore.toISOString(),
  });
  if (error) throw error;
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
  // Same `in:anywhere`/`-in:drafts` reasoning as syncAccount: Sent/archived
  // mail is needed for reply-reciprocity and the chat view's outbound
  // bubbles, but a never-sent draft must never be ingested as a message —
  // see sync.ts for the real-account case this was found from.
  //
  // `-in:spam` differs from syncAccount deliberately: ongoing sync keeps spam
  // so a live misclassification is still visible, but backfill is about
  // catching up on history, where stale spam has no value — it's been sitting
  // there for months/years unread by definition, and skipping it shrinks the
  // fetch volume for large mailboxes.
  const query = `in:anywhere -in:drafts -in:spam after:${afterEpoch} before:${beforeEpoch}`;

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

  const listedIds = (list.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id));
  const nextPageToken = list.nextPageToken ?? null;
  // resultSizeEstimate is a rough, approximate count Gmail computes per
  // request — captured once from the job's first chunk and held steady
  // afterward, since a shifting denominator would make the progress bar look
  // like it's moving backward as later pages recompute their own estimate.
  const messagesEstimated =
    job.messages_estimated ?? list.resultSizeEstimate ?? null;

  // Skip the expensive messages.get + parse path entirely for ids already in
  // the table — cheap to check (one indexed query) versus a full fetch. This
  // matters most when a job's page_token gets reset and re-walks a window
  // that's already partly stored (e.g. after a query change mid-job): without
  // this, every already-stored message still costs a full messages.get call
  // even though it can never produce anything new.
  const { data: existing } = await admin
    .from("messages")
    .select("gmail_message_id")
    .eq("email_account_id", account.id)
    .in("gmail_message_id", listedIds);
  const alreadyStored = new Set((existing ?? []).map((r) => r.gmail_message_id));
  const ids = listedIds.filter((id) => !alreadyStored.has(id));

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

        // Defensive: `-in:drafts` above should already exclude these, but a
        // draft was never actually sent to anyone, so it must never be
        // stored as a message regardless of how it was fetched.
        if ((full.labelIds ?? []).includes("DRAFT")) continue;

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

  let newlyStored = 0;
  let threading: ThreadingResult = emptyThreading;
  if (rows.length > 0) {
    // `ids` was already filtered to exclude anything in `messages` for this
    // account (see above), so everything reaching this upsert is expected to
    // be genuinely new — rows.length is the correct messages_done delta.
    // (Upsert's own `.select()` can't be used for this count: Postgres's ON
    // CONFLICT...RETURNING returns a row for every input regardless of
    // whether it inserted or updated, which is what caused progress to run
    // to ~4x the real stored count before this existence check existed.)
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
    newlyStored = rows.length;

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

  // messages_done = messages_done + newlyStored, computed in SQL rather than
  // read-then-write in JS — this is what actually closes the race the
  // claim above only narrows: even if this were somehow called twice for
  // the same job, the increment itself can't be lost.
  const { data: updated, error: updateError } = await admin.rpc(
    "increment_backfill_progress",
    {
      p_job_id: job.id,
      p_messages_done_delta: newlyStored,
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
    job.messages_done + newlyStored;

  return {
    status: done ? "complete" : "pending",
    messagesDone: newMessagesDone,
    messagesEstimated,
    fetchedThisStep: newlyStored,
    threading,
  };
}
