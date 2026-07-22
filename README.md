# Wompy

A contact-centric email client for Gmail. Instead of organizing mail by date or
subject thread, Wompy organizes it the way chat apps do: one continuous
conversation per contact (or group of participants).


> **License:** [PolyForm Noncommercial 1.0.0](./LICENSE) — use, self-host, and
> fork freely for noncommercial purposes; commercial use is not permitted.

## Status

Working end to end: Gmail sync, participant-set threading, the Contact/Company
classifier, the chat and list views, reply and compose, delete, read/unread,
search, and a landing page. See **[ROADMAP.md](./ROADMAP.md)** for what's shipped
and what's next.

OAuth tokens are encrypted at rest (AES-256-GCM). The key lives in
`TOKEN_ENCRYPTION_KEY`, deliberately outside the database — keep it out of
backups, and note that changing it makes existing tokens unreadable, requiring
every user to reconnect.

## Stack

- **Next.js 16** (App Router) + React 19 + Tailwind v4
- **Supabase** (Postgres + Auth), Row Level Security, multi-user from day one
- **Gmail API** via OAuth (`googleapis`), polling only (no Pub/Sub in v1)

## Setup

### 1. Install

```bash
npm install
```

### 2. Create external services

**Supabase** — create a project at [supabase.com](https://supabase.com). From
**Settings → API Keys**, copy the Project URL, the **publishable** key
(`sb_publishable_…`), and the **secret** key (`sb_secret_…`). (These are the
current names for the former `anon` and `service_role` keys.)

Apply the schema: open the SQL Editor and run the migrations in order —
[`0001_init.sql`](./supabase/migrations/0001_init.sql) then
[`0002_email_accounts.sql`](./supabase/migrations/0002_email_accounts.sql) (or
use the Supabase CLI: `supabase db push`).

**Google Cloud (Gmail API + Google login)** — one OAuth client serves both
Wompy's "Connect Gmail" flow and Supabase's "Sign in with Google" provider:

1. Create a project, then **enable the Gmail API**.
2. Configure the **OAuth consent screen** (External, Testing mode). Add the
   `gmail.modify` scope. Add your own Google account as a test user.
3. Create an **OAuth 2.0 Client ID** of type **Web application**.
4. Add **two** authorized redirect URIs:
   - `http://localhost:<your-port>/api/auth/gmail/callback` (Wompy's Connect Gmail flow)
   - `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase Google auth)
5. Copy the client ID and secret.

**Enable Google in Supabase** — Dashboard → Authentication → Providers → Google;
paste the same client ID and secret.

### How auth and inboxes relate

Logging in and connecting an inbox are **separate**:

- **Sign up with email + password**, then connect Gmail (or later, other
  providers) from `/debug`; **or**
- **Continue with Google**, which logs you in and — if you grant Gmail access in
  the same consent — connects your inbox in one step. You can decline Gmail and
  still just have an account.

Connected inboxes are stored per-user in the `email_accounts` table with a
`provider` column, so more providers (Yahoo, …) slot in without a schema change.

### 3. Environment

```bash
cp .env.example .env.local
```

Fill in the Supabase and Google values. `.env.local` is gitignored.

### 4. Run

```bash
npm run dev
```

Open <http://localhost:3000>. Sign up (email/password or **Continue with
Google**), then on `/debug` connect Gmail if you haven't, and click **Sync now**.
Note: sync starts fresh from when you connect — no historical mail is imported.

## Scripts

- `npm run dev` — dev server (Turbopack)
- `npm run dev:webpack` — dev server with webpack. See note below.
- `npm run build` — production build (Turbopack)
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint

> **Dev bundler note:** `npm run dev` uses Turbopack, which is noticeably faster.
> It previously crashed on this Windows setup (PostCSS worker, exit `0xc0000142`,
> while compiling `globals.css`), which is why webpack was the default for a
> while; that no longer reproduces. If the crash comes back, fall back to
> `npm run dev:webpack`.

## Before configuring credentials

The app boots without `.env.local`: the auth pages show a “configure me” notice,
protected routes redirect to `/login`, and `/api/sync` returns
`{ "error": "not_configured" }`. Fill in `.env.local` and restart to enable
auth, Gmail connect, and sync.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
