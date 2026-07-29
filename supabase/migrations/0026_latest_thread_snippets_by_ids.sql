-- Wompy migration 0026: latest_thread_snippets scoped to a page of threads.
--
-- The rail was still built from an unbounded fetch: latest_thread_snippets
-- (migration 0025) fixed the WRONG-SHAPE bug (a flat top-400 messages across
-- the whole mailbox instead of one row per thread), but it still ran across
-- every thread the user has, with no bound of its own — and neither did the
-- plain `threads` select feeding it. PostgREST's default 1000-row response
-- cap silently truncated both, invisible until an account crosses 1000
-- threads (confirmed: a real test account with 1,516 threads only ever saw
-- the newest ~1000, cutting off mid-April even though real mail existed back
-- to the actual 12-month backfill boundary).
--
-- This is the RPC half of the real fix (rail pagination — see
-- src/app/(app)/app/page.tsx and the new /api/rail/more route): the caller
-- now fetches threads per-tab, bounded and ordered, and only asks this
-- function for snippets belonging to THAT specific page of thread ids —
-- never "give me everything," so there is no longer an unbounded query for
-- PostgREST's row cap to silently truncate.

drop function if exists latest_thread_snippets(uuid);

create or replace function latest_thread_snippets(p_thread_ids uuid[])
returns table (thread_id uuid, snippet text, internal_date timestamptz)
language sql
security invoker
set search_path = public
as $$
  select distinct on (m.thread_id)
    m.thread_id,
    m.snippet,
    m.internal_date
  from messages m
  where m.thread_id = any(p_thread_ids)
    and m.trashed_at is null
    and m.is_reaction = false
  order by m.thread_id, m.internal_date desc nulls last;
$$;

grant execute on function latest_thread_snippets(uuid[]) to authenticated, service_role;
