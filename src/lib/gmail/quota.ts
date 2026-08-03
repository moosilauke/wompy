import "server-only";
import type { MethodOptions } from "googleapis-common";

/**
 * Retry/backoff options for Gmail API calls.
 *
 * Nothing in this codebase previously handled a Gmail 429 (quota exceeded) or
 * a transient 5xx — either would throw, abort the whole sync, and only get
 * retried on the next 2-minute poll from scratch (see ROADMAP's "Rate limits
 * / API failure handling"). Historical sync makes hitting Gmail's per-user
 * quota (250 units/sec; messages.get = 5 units) far more likely, since it
 * sustains request volume instead of syncing a handful of new messages.
 *
 * Rather than hand-rolling a backoff loop, this leans on gaxios's own retry
 * support — every generated Gmail client method (list, get, ...) accepts a
 * `MethodOptions` second argument, which is a `GaxiosOptions`, and gaxios
 * already implements exponential backoff for exactly the status codes that
 * matter here (429, 5xx). It's just off by default (`retry` must be
 * explicitly set); this is that opt-in, applied consistently everywhere a
 * Gmail call is made.
 *
 * Usage: `gmail.users.messages.get(params, GMAIL_RETRY_OPTIONS)`.
 */
export const GMAIL_RETRY_OPTIONS: MethodOptions = {
  retry: true,
  retryConfig: {
    retry: 5,
    retryDelay: 500,
    retryDelayMultiplier: 2,
    maxRetryDelay: 30_000,
    statusCodesToRetry: [
      [408, 408],
      [429, 429],
      [500, 599],
    ],
  },
};

/**
 * How many `messages.get` calls to have in flight at once.
 *
 * Gmail has no batch fetch for message bodies (unlike batchModify), so
 * throughput has to come from a small worker pool. Shared by regular sync and
 * historical backfill so the combined load stays easy to reason about: at 5
 * quota units per get, 10 concurrent is 50 units/sec per job, and the two can
 * run at the same time (the backfill poller fires every ~1.5s while a sync
 * runs every 2 minutes) — so ~100 units/sec worst case, against Gmail's ~250
 * units/sec per-user budget. GMAIL_RETRY_OPTIONS covers the rest.
 *
 * Raising this means re-checking that headroom, which is why it lives here
 * rather than being defined twice.
 */
export const GMAIL_FETCH_CONCURRENCY = 10;
