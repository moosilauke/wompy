-- Wompy migration 0027: user-selectable tab counter + the RPC to compute it.
--
-- The Contacts/Companies/Spam badges have only ever shown thread count. This
-- adds a per-user preference (profiles.tab_count_mode) letting someone choose
-- threads / messages / unread threads / unread messages instead, plus a
-- tab_counts() RPC that computes all four variants in one query per tab —
-- cheaper than four separate query shapes, and lets the caller switch which
-- field it reads without a second round-trip when the preference changes.
--
-- Unread is derived the same way the app already does in page.tsx: a thread
-- is unread when its last_message_at is newer than the caller's
-- thread_reads watermark for it (or no watermark row exists at all, which
-- reads as "never opened" — same epoch-default semantics as the existing
-- in-app comparison). "Unread messages" counts messages newer than that same
-- watermark, not every message in an unread thread — a thread you last read
-- through message 3 of 5 only has 2 unread messages, not 5.

create type tab_count_mode as enum (
  'threads',
  'messages',
  'unread_threads',
  'unread_messages'
);

alter table profiles
  add column if not exists tab_count_mode tab_count_mode not null default 'unread_messages';

create or replace function tab_counts(p_tab contact_tab)
returns table (
  threads bigint,
  messages bigint,
  unread_threads bigint,
  unread_messages bigint
)
language sql
security invoker
set search_path = public
as $$
  select
    count(distinct t.id),
    count(m.id) filter (where m.trashed_at is null and m.is_reaction = false),
    count(distinct t.id) filter (
      where r.last_read_at is null or t.last_message_at > r.last_read_at
    ),
    count(m.id) filter (
      where m.trashed_at is null and m.is_reaction = false
        and m.internal_date > coalesce(r.last_read_at, 'epoch'::timestamptz)
    )
  from threads t
  left join messages m on m.thread_id = t.id
  left join thread_reads r on r.thread_id = t.id and r.user_id = t.user_id
  where t.tab = p_tab;
$$;

grant execute on function tab_counts(contact_tab) to authenticated, service_role;
