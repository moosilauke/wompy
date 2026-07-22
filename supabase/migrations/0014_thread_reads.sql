-- Wompy-native read state.
--
-- Read/unread was derived from Gmail's UNREAD label, which meant every
-- mark-read was a Gmail batchModify round-trip (~150ms) and Gmail's state and
-- Wompy's could never diverge. Read state is a per-client view preference, not a
-- fact about the mail: marking something read in Wompy shouldn't touch Gmail,
-- and vice versa. This makes it Wompy's own, stored here so it follows the user
-- across devices.
--
-- A watermark per thread rather than a row per message: one write when a thread
-- is opened, and "unread" is simply "has a message newer than the watermark".
-- A new message naturally makes the thread unread again with no extra work, and
-- the table only grows with threads the user has actually opened.

create table if not exists thread_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references threads(id) on delete cascade,

  -- The instant of the newest message the user had seen when they last opened
  -- this thread. A thread is unread when its latest message is newer than this.
  last_read_at timestamptz not null,

  updated_at timestamptz not null default now(),

  primary key (user_id, thread_id)
);

create index if not exists thread_reads_user_idx on thread_reads (user_id);

alter table thread_reads enable row level security;

-- The user reads and writes their own watermarks directly from the client, so
-- unlike most tables this grants insert/update too rather than routing through
-- the service role. A watermark is not sensitive and touches only the user's
-- own rows.
create policy "thread_reads_select_own"
  on thread_reads for select
  using (auth.uid() = user_id);

create policy "thread_reads_insert_own"
  on thread_reads for insert
  with check (auth.uid() = user_id);

create policy "thread_reads_update_own"
  on thread_reads for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on thread_reads to authenticated;
grant all on thread_reads to service_role;
