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
