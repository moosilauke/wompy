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

---

## Next up

### 1. Key rotation path
Tokens are encrypted, but there's no way to re-key without every user
reconnecting. The `v1:` envelope prefix was designed for this — a rotation
script would decrypt with the old key and re-encrypt with the new one. Not
urgent, but cheaper to build before there are many rows.

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
- **Admin panel** — user list with actions is done (see Shipped). Still to add:
  subscription status (needs the payments work first)
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
- **Special handling of some attachment types** — e.g. for images, preview in modal overlay vs ONLY download (maybe even display thumbnail too?); for calendar invites, option to open in the same calendar as the email provider (e.g. if syncing Gmail, then ICS opens Google Calendar to add calendar invite automatically)
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
