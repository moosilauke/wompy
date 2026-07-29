-- Wompy migration 0021: atomic claim + progress increment for backfill_jobs.
--
-- /api/backfill/step previously read a job row, computed its new
-- messages_done in application code, then wrote it back — classic
-- read-then-write race: two overlapping calls (an eager client re-polling,
-- a double-click, a retried request) could both read the same stale
-- messages_done and one write would silently clobber the other's progress,
-- losing an entire page of messages with no error.
--
-- Two functions close this:
--   claim_backfill_job:      atomically flips a job from pending -> running
--                             (or no-ops and returns nothing if it's already
--                             running), so only one concurrent call can ever
--                             be actively processing a given job.
--   increment_backfill_progress: does messages_done = messages_done + $n in
--                             SQL, not JS, so the increment itself can never
--                             be lost to a race even if the claim above were
--                             somehow bypassed.

create or replace function claim_backfill_job(p_job_id uuid)
returns setof backfill_jobs
language sql
security definer
set search_path = public
as $$
  update backfill_jobs
  set status = 'running'
  where id = p_job_id
    and status in ('pending', 'failed')
  returning *;
$$;

create or replace function increment_backfill_progress(
  p_job_id uuid,
  p_messages_done_delta integer,
  p_page_token text,
  p_messages_estimated integer,
  p_status backfill_status,
  p_last_error text
)
returns setof backfill_jobs
language sql
security definer
set search_path = public
as $$
  update backfill_jobs
  set messages_done = messages_done + p_messages_done_delta,
      page_token = p_page_token,
      messages_estimated = coalesce(messages_estimated, p_messages_estimated),
      status = p_status,
      last_error = p_last_error
  where id = p_job_id
  returning *;
$$;
