# Wompy

A contact-centric email client for Gmail. Instead of organizing mail by date or
subject thread, Wompy organizes it the way chat apps do: one continuous
conversation per contact (or group of participants).

See [`wompy-mvp-plan.md`](./wompy-mvp-plan.md) for product scope and data model,
and the Claude Design spec for visual direction.

> **License:** [PolyForm Noncommercial 1.0.0](./LICENSE) — use, self-host, and
> fork freely for noncommercial purposes; commercial use is not permitted.

## Status

Backend foundation done: Next.js scaffold, Supabase schema + auth (email/password
**and** Sign in with Google), provider-generic `email_accounts`, Gmail OAuth
connect, and raw message sync. No classifier, threading, or designed UI yet —
those are later steps. A throwaway `/debug` view validates the data flow.

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
**Settings → API**, copy the Project URL, the `anon` key, and the `service_role`
key.

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
   - `http://localhost:3000/api/auth/gmail/callback` (Wompy's Connect Gmail flow)
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

- `npm run dev` — dev server (webpack). See note below.
- `npm run dev:turbo` — dev server with Turbopack
- `npm run build` — production build (Turbopack)
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint

> **Dev bundler note:** `npm run dev` uses webpack because Turbopack's dev-mode
> PostCSS worker was crashing on this Windows setup (exit `0xc0000142`) while
> compiling `globals.css`. The production build (`npm run build`) uses Turbopack
> and works fine. If Turbopack dev works on your machine, use `npm run dev:turbo`.

## Before configuring credentials

The app boots without `.env.local`: the auth pages show a “configure me” notice,
protected routes redirect to `/login`, and `/api/sync` returns
`{ "error": "not_configured" }`. Fill in `.env.local` and restart to enable
auth, Gmail connect, and sync.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
