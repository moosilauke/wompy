# Wompy — Roadmap

Working status and build order. Update this as things ship; it is the shared
source of truth so decisions don't live only in chat history or a plan file.

Last updated: 2026-07-21

---

## Shipped

**Foundation**
- Next.js 16 + React 19 + Tailwind v4 scaffold, Supabase schema, RLS
- Email/password auth + "Continue with Google" that connects Gmail in one step
- Gmail OAuth, token capture and refresh

**Mail pipeline**
- Raw sync into `messages` (polling, no backfill — starts at connect time)
- Participant-set threading: a thread is everyone on the message except you
- Gmail alias canonicalization (dots, `+tags`)
- Classifier, rules 0–6 (see `src/lib/email/classifier.ts`)
- Sent-mail sync, so reply-reciprocity and outgoing bubbles work

**UI**
- App shell: contact rail + reading pane, chat bubbles, day dividers
- Contacts (chat view) / Companies (list view) / Spam quarantine
- More ▾ menu: Sent, Trash, Spam
- Reply and net-new compose (365-char constraint, full-email escape hatch)
- Delete → Gmail Trash, with undo; right-click menus at thread and message level
- Read/unread, mirrored to Gmail's UNREAD label
- Message excerpting: quoted history + signature stripped, full text in a modal
- HTML-only mail converted to readable text (41% of the corpus)
- Search: people (trigram) + messages (Postgres FTS over excerpted bodies)
- Landing page that IS the app shell, statically rendered
- Unified sign-in/sign-up in a modal

**Performance** — sync cycle went from ~8s to well under 1s
- Batched classification writes (was N+1: ~44 sequential round-trips per sync)
- Parallelized page queries; stopped over-fetching `body_text` and `raw_headers`
- Local JWT verification (`getClaims`) instead of auth-server round-trips
- Client cache + instant client-side tab switching
- Batched delete/undo (was one Gmail call per message at ~464ms each — a
  12-message thread took ~5.5s; now one request regardless of size)

**Auth**
- Google sign-in no longer re-prompts for consent on every login; `prompt:
  consent` is kept only on the explicit "Connect Gmail" path where a fresh
  refresh token is the point
- Dead or missing refresh tokens surface a "Reconnect Gmail" button instead of
  a generic sync error, and pause polling rather than retrying a guaranteed
  failure

---

## Next up

### 1. Manual override for classification
The last unbuilt item from the original MVP build order, and the one with the
most evidence behind it: the classifier has now been wrong in the field three
times (Abigail → Companies, Hyundai → Contacts, spam → Contacts). Each time the
fix was a code change.

`contacts.manually_overridden` already exists and the classifier already
respects it — there is no UI. Right-click a rail row → "Move to Contacts /
Companies / Spam".

Until this exists, every misclassification needs a developer.

### 2. Attachments
Sync captures nothing — no filenames, no MIME parts. Someone sends a PDF and
Wompy shows a message with no sign it exists. That is silently losing
information the user was sent, which is worse than a missing feature.

Design spec calls for an inline chip in the bubble, not a separate tray.

### 3. Token encryption at rest
Gmail refresh tokens sit in plaintext in `email_accounts`. Acceptable for a
single-user dev project; **not** acceptable before anyone else connects an
account. Should land before any deploy.

---

## Backlog

- **Settings/profile page** — collect deferred preferences (see below) until
  there are enough to justify building it
  - Tab badge counts: totals vs unreads
- **Sender logos** — investigated 2026-07-21, parked. Must be server-side and
  cached: a client-side fetch would tell a third party which brands email the
  user, the same tracking behaviour avoided by converting HTML mail to text.
  46% of sending domains are ESP subdomains needing registrable-domain
  extraction; `feefo.com` renders as "Charles Tyrwhitt", so a confident wrong
  logo is a real risk.
- **Static pages** — documentation, privacy policy, about, Wompy vs Alternatives (competitive page), contact/help
- **Payment/subscriptions** — will use Creem
- **Profile page** — includes email provider config/reconfig, personal settings, avatar upload, etc
- **Stats page** — unlike Gmail etc, we'll gamify things slightly by displaying some fun stats/metrics/analytics; leans into our brand ethos of being more than just a Gmail clone
- **Admin panel** — need a place for admins, starting with basic info like seeing all users, basic metadata about them, subscription status, triggering password reset emails, etc
- **Transactional emails** — welcome, account confirmation, password reset. Using Resend on another project and will likely use here too.
- **Continue performance enhancements** — delete is fixed (batched); next
  candidates are per-thread message fetch and the full-mailbox reclassify that
  runs on every sync
- **Rate limits / API failure handling** — nothing currently handles Gmail 429s
  or a failed token refresh beyond the reauth case. Invisible with one user,
  routine with fifty.
- **Contact and contacts' messages multi-select** — ability, via keyboard (ctrl and shift-click) and GUI to select multiple contact conversations and/or select multiple messages/emails from a contact
- **Create groups** — net new messages only allow selecting one recipient currently vs multiple
- **Add forwarding** — ability to forward a message to another contact(s)
- **Emoji reactions** — for clients that also support it, add emoji reactions on messages
- **Add icons** — icons will help add visual interest and clue users in more quickly to various functions of a given button/menu
- **Display full/rich HTML emails** — appears we're converting HTML to text vs selectively rendering some or all of the HTML
- **Yahoo, Outlook, or iCloud Mail provider** — `src/lib/email/providers.ts` is already a registry
- **Reply-to-one** in group threads (currently replies go to all participants)
- **Spam false-positive escape** — a quarantined sender can only be rescued by
  replying to them in Gmail
- **Deploy** — blocked on token encryption
- `staleTimes` is an experimental Next flag; revisit when it stabilizes

---

## Deliberate non-goals

From the MVP plan, still holding:

- **No AI features** of any kind — brand stance, not a placeholder
- **No history backfill** — sync starts when you connect
- **No Gmail push/Pub-Sub** — polling only
- No per-sender learned signature detection (delimiter and heuristic only)
- No tracking-pixel-vs-photo image classification

Two original non-goals were built anyway, deliberately: **net-new compose** and
**search**.
