-- Wompy migration 0025: per-thread latest-snippet lookup, not a global cap.
--
-- src/app/(app)/app/page.tsx built its "which threads still have visible
-- content" map from a flat `messages` query: newest 400 messages across the
-- ENTIRE mailbox, then filtered threads down to whichever ones had a message
-- in that window. The comment above it said "latest surviving message per
-- thread," but the query itself had no per-thread scoping — it was a single
-- global top-400, shared across every thread combined.
--
-- That was invisible at low message volume (400 comfortably covered every
-- thread's latest activity), but historical sync backfills hundreds to
-- thousands of older messages, which pushes genuinely-current threads'
-- latest messages out of a flat top-400 the moment total volume grows past
-- it — silently dropping otherwise-live threads from the rail entirely, with
-- no error, since the SQL was never wrong, just structurally the wrong shape
-- for "current per thread" as the mailbox grows.
--
-- This RPC does the per-thread version directly: one row per thread_id, its
-- most recent non-trashed, non-reaction message. No global cap at all — cost
-- scales with THREAD count, not message count, which is the actual bound
-- that matters for the rail.

create or replace function latest_thread_snippets(p_user_id uuid)
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
  where m.user_id = p_user_id
    and m.thread_id is not null
    and m.trashed_at is null
    and m.is_reaction = false
  order by m.thread_id, m.internal_date desc nulls last;
$$;

grant execute on function latest_thread_snippets(uuid) to authenticated, service_role;
