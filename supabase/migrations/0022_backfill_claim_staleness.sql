-- Wompy migration 0022: self-heal stuck 'running' backfill jobs.
--
-- claim_backfill_job (migration 0021) only reclaimed status IN ('pending',
-- 'failed') — a job that got claimed but whose call then crashed, timed out,
-- or (as seen in real testing) simply lost a concurrency race after another
-- call already claimed it, was left permanently stuck in 'running' with no
-- path back to being processed. Nothing else ever resets a job in this
-- state, so it would stay stuck forever.
--
-- Fix: also reclaim a 'running' job if its updated_at is stale (2 minutes —
-- comfortably longer than a single chunk's Gmail list + N message fetches
-- should ever take, per PAGE_SIZE/FETCH_CONCURRENCY in backfill.ts). A job
-- actually still in flight has an updated_at from moments ago and isn't
-- touched; only a genuinely abandoned one gets reclaimed.

create or replace function claim_backfill_job(p_job_id uuid)
returns setof backfill_jobs
language sql
security definer
set search_path = public
as $$
  update backfill_jobs
  set status = 'running'
  where id = p_job_id
    and (
      status in ('pending', 'failed')
      or (status = 'running' and updated_at < now() - interval '2 minutes')
    )
  returning *;
$$;
