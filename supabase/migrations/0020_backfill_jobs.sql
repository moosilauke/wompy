-- Wompy migration 0020: historical sync — the backfill job cursor.
--
-- Regular sync (syncAccount) only ever fetches mail newer than
-- email_accounts.last_synced_at, deliberately excluding history from before
-- connect. Historical sync fills that gap by fetching backward from connect
-- time, chunked into resumable pages (see HISTORICAL_SYNC_PLAN.md) — but
-- none of the existing watermark columns (last_synced_at, the unused
-- history_id) can represent partial/resumable progress or a visible status,
-- so this is new schema rather than an extension of an existing one.
--
-- One row per email_account_id. range_after/range_before bound the window
-- being backfilled (oldest -> newest already covered by regular sync);
-- page_token is Gmail's own list cursor, persisted across chunk calls so a
-- closed tab or a failed request just resumes on the next call rather than
-- restarting. Extending the range further back later (the Settings "go back
-- further" control) reuses this same row: range_after moves back, page_token
-- resets to null, status returns to 'pending'.

create type backfill_status as enum ('pending', 'running', 'complete', 'failed');

create table backfill_jobs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  email_account_id   uuid not null references email_accounts (id) on delete cascade,

  status             backfill_status not null default 'pending',
  range_after         timestamptz not null,
  range_before        timestamptz not null,

  page_token         text,
  messages_done      integer not null default 0,
  messages_estimated integer,

  last_error         text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (email_account_id)
);

create index backfill_jobs_user_id_idx on backfill_jobs (user_id);

create trigger backfill_jobs_set_updated_at
  before update on backfill_jobs
  for each row execute function set_updated_at();

alter table backfill_jobs enable row level security;

create policy "own backfill_jobs"
  on backfill_jobs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
