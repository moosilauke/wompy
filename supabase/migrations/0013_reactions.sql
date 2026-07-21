-- Emoji reactions received on messages.
--
-- A reaction arrives as a real email carrying In-Reply-To plus a specially
-- typed MIME part. Rather than storing it as a message (which would put a
-- one-character "reply" in the conversation), it is extracted at sync time into
-- this table and the carrier message is suppressed from the thread view.
--
-- Kept separate from `messages` rather than added as a column because one
-- message can collect many reactions from many people, and each needs its own
-- sender and timestamp.

create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The message being reacted to. Null while the target hasn't been synced yet
  -- — a reaction can arrive before, or without, the message it refers to.
  message_id uuid references messages(id) on delete cascade,

  -- The carrier email, so re-syncing doesn't duplicate the reaction and the
  -- message can be suppressed from the conversation.
  gmail_message_id text not null,

  -- In-Reply-To of the carrier: how the reaction finds its target if the target
  -- arrives later.
  target_message_id_header text,

  -- Who reacted, and with what.
  from_address text not null,
  emoji text not null,
  reacted_at timestamptz,

  created_at timestamptz not null default now(),

  -- One reaction per sender per carrier email. Re-syncing re-derives the same
  -- row rather than stacking duplicates.
  unique (user_id, gmail_message_id)
);

create index if not exists reactions_message_idx on reactions (message_id);
create index if not exists reactions_target_header_idx
  on reactions (user_id, target_message_id_header)
  where message_id is null;

alter table reactions enable row level security;

create policy "reactions_select_own"
  on reactions for select
  using (auth.uid() = user_id);

grant select on reactions to authenticated;
grant all on reactions to service_role;

-- Marks a message as a reaction carrier so the thread view can skip it. Set at
-- ingest; a column on `messages` rather than a join because every render of a
-- conversation needs to filter on it.
alter table messages
  add column if not exists is_reaction boolean not null default false;

create index if not exists messages_not_reaction_idx
  on messages (thread_id)
  where is_reaction = false and trashed_at is null;
