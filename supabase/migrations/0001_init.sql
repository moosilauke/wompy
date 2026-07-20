-- Wompy initial schema (MVP build step 1).
--
-- Data model per wompy-mvp-plan.md. Multi-user from day one: every row is scoped
-- by user_id (references auth.users) and protected by Row Level Security so a user
-- can only ever read/write their own rows. The Gmail sync writer uses the
-- service-role key (bypasses RLS) and sets user_id explicitly.
--
-- This session writes only to `gmail_accounts` and `messages`. `contacts` and
-- `threads` are created so the schema is complete, but stay empty until the
-- classifier (step 2) and threading (step 3) sessions populate them.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- A sender is classified into one of two tabs (the "two-tab split").
create type contact_tab as enum ('contact', 'company');

-- ---------------------------------------------------------------------------
-- gmail_accounts: one connected Gmail per (user, email).
-- ---------------------------------------------------------------------------
create table gmail_accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  email           text not null,

  -- OAuth tokens. NOTE: stored plaintext for now; encrypting at rest is a
  -- later hardening item (tracked in the plan, intentionally not blocking v1).
  access_token    text,
  refresh_token   text,
  token_expiry    timestamptz,

  -- Polling bookkeeping (no Pub/Sub in v1 — see plan non-goals).
  history_id      text,
  last_synced_at  timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (user_id, email)
);

create index gmail_accounts_user_id_idx on gmail_accounts (user_id);

-- ---------------------------------------------------------------------------
-- messages: raw-ish synced Gmail data. The only table the sync writer fills
-- this session. One row per Gmail message per connected account.
-- ---------------------------------------------------------------------------
create table messages (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  gmail_account_id   uuid not null references gmail_accounts (id) on delete cascade,

  -- Gmail identifiers.
  gmail_message_id   text not null,           -- Gmail API message id
  gmail_thread_id    text,                    -- Gmail's own threadId (not our threading key)

  -- Addressing.
  from_address       text,
  to_addresses       text[],
  cc_addresses       text[],

  -- Subject is stored for possible future "jump to topic" but NOT surfaced in
  -- the chat view (threading model: subject changes don't split threads).
  subject            text,

  -- RFC 2822 threading headers — required to send correct replies later.
  message_id_header  text,                    -- Message-ID
  in_reply_to        text,                    -- In-Reply-To
  references_header  text,                    -- References (raw chain)

  -- Body / preview.
  snippet            text,
  body_text          text,
  body_html          text,

  internal_date      timestamptz,             -- Gmail internalDate

  -- Full header map (jsonb). Captures classifier-relevant headers like
  -- List-Unsubscribe and Precedence for the step-2 classifier session.
  raw_headers        jsonb not null default '{}'::jsonb,

  created_at         timestamptz not null default now(),

  -- Idempotency: re-syncing must not duplicate. Unique per account + gmail id.
  unique (gmail_account_id, gmail_message_id)
);

create index messages_user_id_idx on messages (user_id);
create index messages_account_date_idx on messages (gmail_account_id, internal_date desc);
create index messages_gmail_thread_idx on messages (gmail_thread_id);

-- ---------------------------------------------------------------------------
-- contacts: one row per sender/participant. Populated by the classifier (step 2)
-- and threading (step 3) — created now, left empty this session.
-- ---------------------------------------------------------------------------
create table contacts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,

  -- Canonical email address of the sender/participant.
  address                text not null,
  display_name           text,

  -- Classifier output.
  tab                    contact_tab not null default 'company',
  manually_overridden    boolean not null default false,
  classification_signals jsonb not null default '{}'::jsonb,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  unique (user_id, address)
);

create index contacts_user_id_idx on contacts (user_id);

-- ---------------------------------------------------------------------------
-- threads: keyed by the sorted set of participants (excluding the user).
-- Populated by threading (step 3) — created now, left empty this session.
-- ---------------------------------------------------------------------------
create table threads (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,

  -- Sorted, lowercased participant addresses excluding the user. The group-chat
  -- thread key: a 1:1 and a 3-person thread with the same first two people are
  -- distinct threads. A canonical text form is stored for a uniqueness constraint.
  participant_set   text[] not null,
  participant_key   text not null,            -- e.g. sorted addresses joined by '\n'

  tab               contact_tab not null default 'company',
  last_message_at   timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (user_id, participant_key)
);

create index threads_user_id_idx on threads (user_id);

-- Link messages to threads once threading exists. Nullable now (unpopulated).
alter table messages
  add column thread_id uuid references threads (id) on delete set null;

create index messages_thread_id_idx on messages (thread_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger gmail_accounts_set_updated_at
  before update on gmail_accounts
  for each row execute function set_updated_at();

create trigger contacts_set_updated_at
  before update on contacts
  for each row execute function set_updated_at();

create trigger threads_set_updated_at
  before update on threads
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: users see only their own rows.
-- The service-role key (used by the sync writer) bypasses RLS entirely, so no
-- policy is needed for it; it sets user_id explicitly on insert.
-- ---------------------------------------------------------------------------
alter table gmail_accounts enable row level security;
alter table messages       enable row level security;
alter table contacts       enable row level security;
alter table threads        enable row level security;

create policy "own gmail_accounts"
  on gmail_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own messages"
  on messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own contacts"
  on contacts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own threads"
  on threads for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
