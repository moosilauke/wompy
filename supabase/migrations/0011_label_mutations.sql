-- Add/remove a single label across a set of messages.
--
-- label_ids mirrors Gmail's labels and is the source of truth for read state
-- (as it already is for TRASH), so there is no separate read_at column that
-- could drift. Reading mail in Gmail clears UNREAD here on the next poll, and
-- marking it read here clears it there.
--
-- PostgREST cannot express array element removal, and doing it read-modify-write
-- from the application would race the sync poller: a poll landing between the
-- read and the write would restore the label. These mutate the array in a single
-- statement instead.
--
-- SECURITY INVOKER with an explicit user_id predicate, so RLS applies.

create or replace function public.strip_message_label(
  p_user_id uuid,
  p_message_ids uuid[],
  p_label text
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  update messages
     set label_ids = array_remove(label_ids, p_label)
   where user_id = p_user_id
     and id = any(p_message_ids)
     and label_ids @> array[p_label];

  get diagnostics updated = row_count;
  return updated;
end;
$$;

create or replace function public.add_message_label(
  p_user_id uuid,
  p_message_ids uuid[],
  p_label text
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  update messages
     set label_ids = array_append(label_ids, p_label)
   where user_id = p_user_id
     and id = any(p_message_ids)
     -- Guard against duplicates: the array is a set in practice.
     and not (label_ids @> array[p_label]);

  get diagnostics updated = row_count;
  return updated;
end;
$$;

grant execute on function public.strip_message_label(uuid, uuid[], text) to authenticated, service_role;
grant execute on function public.add_message_label(uuid, uuid[], text) to authenticated, service_role;

-- Unread lookups hit this on every render of the rail.
create index if not exists messages_unread_idx
  on messages (user_id, thread_id)
  where label_ids @> array['UNREAD'] and trashed_at is null;
