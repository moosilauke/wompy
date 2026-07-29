-- Wompy migration 0024: keep threads.last_message_at monotonically increasing.
--
-- groupMessagesIntoThreads processes messages in small chunks (25 at a time
-- during historical backfill) and previously upserted threads with a plain
-- `INSERT ... ON CONFLICT DO UPDATE SET last_message_at = excluded.last_message_at`
-- — a blind overwrite. Historical sync fetches OLDER mail than what's already
-- synced, so a later chunk of older messages touching a participant key that
-- already has a newer thread could regress last_message_at backward,
-- corrupting the thread's sort position in the rail (last_message_at drives
-- the rail's ordering — see src/app/(app)/app/page.tsx).
--
-- Fix: a dedicated upsert function that takes GREATEST(existing, incoming)
-- instead of unconditionally overwriting, so no chunk — regardless of
-- processing order — can ever move a thread's last_message_at backward.

create or replace function upsert_threads_monotonic(p_rows jsonb)
returns setof threads
language sql
security definer
set search_path = public
as $$
  insert into threads (user_id, participant_set, participant_key, last_message_at)
  select
    (r->>'user_id')::uuid,
    array(select jsonb_array_elements_text(r->'participant_set')),
    r->>'participant_key',
    (r->>'last_message_at')::timestamptz
  from jsonb_array_elements(p_rows) as r
  on conflict (user_id, participant_key) do update
    set last_message_at = greatest(
      threads.last_message_at,
      excluded.last_message_at
    )
  returning *;
$$;

revoke execute on function upsert_threads_monotonic(jsonb) from public, anon, authenticated;
grant execute on function upsert_threads_monotonic(jsonb) to service_role;
