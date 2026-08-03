# Wompy — Roadmap

Working status and build order. Update this as things ship; it is the shared
source of truth so decisions don't live only in chat history or a plan file.

Last updated: 2026-08-03

---

## Shipped

**Foundation**
- Next.js 16 + React 19 + Tailwind v4 scaffold, Supabase schema, RLS
- Email/password auth + "Continue with Google" that connects Gmail in one step
- Gmail OAuth, token capture and refresh

**Mail pipeline**
- Raw sync into `messages` (polling)
- Participant-set threading: a thread is everyone on the message except you
- Gmail alias canonicalization (dots, `+tags`)
- Classifier, rules 0–6 (see `src/lib/email/classifier.ts`), scoped to
  changed contacts/threads per sync rather than a full-mailbox rescan
- Sent-mail sync, so reply-reciprocity and outgoing bubbles work
- **Historical sync** — new accounts backfill the last 12 months automatically,
  chunked and resumable via client-driven polling (no job queue/background-function
  infra needed). Settings shows live progress per account and a "go back
  further" control (1 more year / 5 more years / all mail) once the initial
  window completes. Verified against a real 37,400+ message mailbox. Backfill
  excludes spam (stale spam has no value and only slows a large catch-up down);
  ongoing sync still includes it so a live misclassification stays visible.
  Gmail 429s/5xx now retry with backoff on every read call (list + get), for
  both regular sync and backfill. See `HISTORICAL_SYNC_PLAN.md` for the full
  design record.

**UI**
- App shell: contact rail + reading pane, chat bubbles, day dividers
- Contacts (chat view) / Companies (list view) / Spam quarantine
- More ▾ menu: Sent, Trash, Spam
- Reply and net-new compose (365-char constraint, full-email escape hatch)
- Delete → Gmail Trash, with undo; right-click menus at thread and message level
- Read/unread — Wompy-native, a per-thread read watermark in Supabase. No Gmail
  round-trip on mark-read; state follows the user across devices and is
  independent of Gmail's own read state
- Message excerpting: quoted history + signature stripped, full text in a modal
- HTML-only mail converted to readable text (41% of the corpus)
- Search: people (trigram) + messages (Postgres FTS over excerpted bodies)
- Attachments: inline chips in the bubble, downloaded from Gmail on demand
  (metadata only, no duplicated blobs). Inline images and duplicate `.ics`
  encodings filtered out
- **Manual override** — right-click a conversation → Move to Contacts /
  Companies / Spam. Recorded against the sender, so it holds for future
  conversations too, and survives every classify run. This was the last unbuilt
  item from the original MVP build order; misclassifications no longer need a
  developer to fix.
- Organization names derived for functional addresses (`no-reply@sentinelone.com`
  → "SentinelOne"), only where the local part is generic and the domain isn't
  free-mail
- Welcome email via Mailtrap, sent once per new user (guarded by
  `profiles.welcomed_at`) across both the Google-OAuth and email/password signup
  paths. Never blocks signup. Confirmation & password-reset stay on Supabase's
  secure token flows.
- Company logos via Brandfetch Logo Link, on the Companies tab only. Resolves
  the registrable domain (email.schwab.com → schwab.com), skips ESP domains that
  would show the wrong brand (feefo.com), never people or spam, and falls back
  to colored initials when a logo is absent or fails. Needs
  `NEXT_PUBLIC_BRANDFETCH_CLIENT_ID`; without it, logos are silently skipped.
- Account menu (top-right): sync, sign out, and placeholders for Profile /
  Settings / Admin. Sync errors and the reconnect prompt stay in the bar rather
  than behind a click
- Emoji reactions, send and receive. Sent as real email carrying both Gmail's
  and RFC 9078's reaction formats; the picker only appears when every recipient
  is on a reaction-capable provider (Gmail / Microsoft), since there's no way to
  detect support and the fallback is a plain-text reply. Badges overlap the
  bubble's bottom-left corner.
- Landing page that IS the app shell, statically rendered
- Unified sign-in/sign-up in a modal
- Admin panel: user list (email, created, last login, login + mail provider,
  admin flag) with per-row delete / make-admin / password-reset. Three
  independent access layers — the menu item renders only for admins, the /admin
  page and /api/admin 404 for non-admins (not 403/redirect, so the panel's
  existence isn't revealed), and every action re-verifies is_admin server-side
  against the verified JWT. Self-delete and last-admin removal are blocked; admin
  state lives in a profiles table, seeded to kevincole@gmail.com.

**Performance** — sync cycle went from ~8s to well under 1s
- Batched classification writes (was N+1: ~44 sequential round-trips per sync)
- Parallelized page queries; stopped over-fetching `body_text` and `raw_headers`
- Local JWT verification (`getClaims`) instead of auth-server round-trips
- Client cache + instant client-side tab switching
- Batched delete/undo (was one Gmail call per message at ~464ms each — a
  12-message thread took ~5.5s; now one request regardless of size)
- **Optimistic mutations** — delete, mark read/unread, and move-to-tab apply to
  the rail on click rather than after the server confirms, and roll back if the
  request fails. Undo restores the row instantly too. Bulk multi-select
  inherits all of it, since it delegates to the same three functions. Opening
  an unread thread now patches the rail directly instead of triggering a
  full-page `router.refresh()` for a one-field change
- **Long conversations fully readable** — the pane query has always been capped
  at 200 messages with nothing in the UI to say so; a 366-message thread simply
  lost 166 of them. Both panes now page backwards through history on demand,
  via a composite `(internal_date, id)` cursor (messages within a thread do
  share timestamps, and a timestamp-only cursor would skip whole groups at a
  page boundary). The scroll position holds when earlier messages are prepended
- **Parallelized the sync message fetch** — regular sync fetched up to 200
  messages one at a time while backfill had solved the identical problem with a
  worker pool; sync now uses the same pool, sharing one concurrency constant so
  the combined Gmail quota load is defined in one place. It also skips fetching
  messages already stored, which the second-granularity watermark means it
  re-lists on most polls
- **Bounded the last unbounded page queries** — `contacts` and `thread_reads`
  were fetched in full on every render (and every 2-minute background refresh)
  to answer questions about the ≤600 threads on screen, and both silently
  truncated at PostgREST's 1000-row cap. Compose suggestions moved to
  `/api/contacts/suggestions`, fetched when the dialog opens rather than
  serialized into every render's payload
- **Instant conversation open** — clicking a rail row was a full server
  navigation that re-ran the whole `force-dynamic` page (~12 queries plus
  dependent waves) with no loading state, so the old conversation sat there and
  the clicked row didn't even highlight. Now the header, avatar, and composer
  paint on the same frame as the click from rail data the client already holds,
  and only the messages are fetched, from a scoped `/api/thread/[id]`. Bubbles
  arrive behind a skeleton. Mapping lives in `lib/email/pane.ts`, shared with
  the server-rendered path so the two can't drift
- **Optimistic send** — the typed text used to sit frozen in the composer
  across four sequential round-trips (auth, account lookup, the Gmail send, and
  a second Gmail call to read the message back). Now the bubble appears and the
  box clears on the same frame, then the real message quietly takes its place
  (matched on Gmail's message id, so sending "ok" twice doesn't collapse into
  one). A message in flight looks exactly like a sent one — deliberately: sends
  essentially always succeed, and a "sending…" treatment would advertise the
  latency rather than hide it. Only a genuine failure gets a treatment: the
  bubble stays put, says "Not sent", and offers a retry, so nothing written is
  ever lost or silently dropped. `/api/send` was also the last route still
  paying `getUser()`'s ~120ms auth round-trip
- **Stopped fetching `body_html` that's never used** — the pane query pulled
  both body columns for every message, but HTML is only needed for the ~28%
  with no `body_text`. It's ~91% of the bytes in a thread: the heaviest
  conversation in the test mailbox was fetching 13 MB to render 246 KB. Now
  fetched only for the rows that actually need it
- **Halved the rail's render cost** — the contact rail was being rendered twice
  (inline for desktop, again inside the mobile drawer, with only CSS hiding the
  irrelevant one), so 200 threads cost 400 rows, each carrying a context menu
  subscribed to four contexts. Only the one matching the viewport mounts now.
  Same idea for the reaction picker: it was mounted per message (200 client
  components per thread) for a control invisible until hover

**Auth & security**
- Google sign-in no longer re-prompts for consent on every login; `prompt:
  consent` is kept only on the explicit "Connect Gmail" path where a fresh
  refresh token is the point
- Dead or missing refresh tokens surface a "Reconnect Gmail" button instead of
  a generic sync error, and pause polling rather than retrying a guaranteed
  failure
- **OAuth tokens encrypted at rest** (AES-256-GCM, key in `TOKEN_ENCRYPTION_KEY`
  outside the database). Versioned envelope so the key can be rotated later;
  `npm run encrypt-tokens` migrates any legacy plaintext rows
- **Key rotation path** — `TOKEN_ENCRYPTION_KEY_PREVIOUS` lets `decryptToken`
  fall back to the old key during a rotation window (GCM's auth tag decides
  which key is right, no guessing); `npm run rotate-token-key -- --apply`
  re-encrypts every row onto the current key so the previous one can be
  retired. Runbook in `README.md` and `scripts/rotate-token-key.mjs`
- **Deployed and live** at www.wompymail.com (Netlify). No marketing has gone
  out yet — deliberate, per past experience that signups don't show up
  overnight regardless — but the app is reachable and functional for anyone
  who finds it right now, not just in local dev.
- **Static pages**: About, Documentation, Get Help (with a contact form to
  hello@wompymail.com), linked from the footer and the rail's More menu

---

## Next up

Being live (even unmarketed) changes what "urgent" means — anyone could sign
up today, so gaps that were invisible in local dev are now real risk, not
future risk.

---

## Backlog

- **Settings/profile page** — collect deferred preferences (see below) until
  there are enough to justify building it
  - Tab badge counts: totals vs unreads
- **Static pages** — Wompy vs Alternatives (competitive page)
- **Payment/subscriptions** — will use Creem
- **Profile page** — includes email provider config/reconfig, personal settings, avatar upload, etc
- **Add 2nd email provider** — likely Apple iCloud Mail or whatever it's called; need to seriously consider supporting multiple providers via one inbox
- **Stats page** — unlike Gmail etc, we'll gamify things slightly by displaying some fun stats/metrics/analytics; leans into our brand ethos of being more than just a Gmail clone
- **Admin panel** — user list with actions is done (see Shipped). Still to add:
  subscription status (needs the payments work first)
- **Transactional emails** — welcome email is done via Mailtrap (see Shipped).
  Account confirmation & password reset stay on Supabase's own token flows;
  point Supabase Auth SMTP at Mailtrap in the dashboard so they deliver
  reliably (config, not code). Future app-originated emails reuse the mailer.
- **Continue performance enhancements** — delete is batched and the common
  mutations are optimistic (see Shipped). The remaining latency is **opening a
  conversation**: it's a full server navigation that re-runs the whole
  `force-dynamic` page (~12 queries plus dependent waves) with no loading state,
  so the click has no visible acknowledgment. Fix is a scoped
  `/api/thread/[id]` route so the pane paints from rail data already held
  client-side. Then optimistic send, and the serial `messages.get` loop in
  `sync.ts` (backfill already solved this with a worker pool).
  Note: "the full-mailbox reclassify on every sync" was listed here for a
  while — it's already fixed; `ClassifyScope` made classification incremental
- **Contacts' messages multi-select** — rail conversation multi-select shipped
  (ctrl/shift-click, bulk mark read/unread, move, delete). Still to do:
  selecting multiple individual messages within one contact's conversation
- **Create groups** — net new messages only allow selecting one recipient currently vs multiple
- **Add forwarding** — ability to forward a message to another contact(s)
- **Special handling of some attachment types** — e.g. for images, preview in modal overlay vs ONLY download (maybe even display thumbnail too?); for calendar invites, option to open in the same calendar as the email provider (e.g. if syncing Gmail, then ICS opens Google Calendar to add calendar invite automatically)
- **Add icons** — icons will help add visual interest and clue users in more quickly to various functions of a given button/menu
- **Display full/rich HTML emails** — appears we're converting HTML to text vs selectively rendering some or all of the HTML
- **Yahoo, Outlook, or iCloud Mail provider** — `src/lib/email/providers.ts` is already a registry
- **Reply-to-one** in group threads (currently replies go to all participants)
- **Spam false-positive escape** — a quarantined sender can only be rescued by
  replying to them in Gmail
- `staleTimes` is an experimental Next flag; revisit when it stabilizes

---

## Deliberate non-goals

From the MVP plan, still holding:

- **No AI features** of any kind — brand stance, not a placeholder
- **No Gmail push/Pub-Sub** — polling only
- No per-sender learned signature detection (delimiter and heuristic only)
- No tracking-pixel-vs-photo image classification

Two original non-goals were built anyway, deliberately: **net-new compose** and
**search**.
