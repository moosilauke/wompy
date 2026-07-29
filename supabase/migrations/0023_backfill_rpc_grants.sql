-- Wompy migration 0023: restrict backfill RPC functions to service_role.
--
-- claim_backfill_job and increment_backfill_progress (migrations 0021, 0022)
-- were created without any grant statement, so Postgres/PostgREST left them
-- at the default exposure: callable by anon AND authenticated via
-- /rest/v1/rpc/<function_name> with an arbitrary job id, and since both are
-- SECURITY DEFINER, that call bypasses RLS entirely — confirmed by
-- Supabase's own security advisor after applying 0022.
--
-- Unlike apply_contact_tabs/apply_thread_tabs (0008), which are SECURITY
-- INVOKER + an explicit user_id ownership check + granted to
-- authenticated/service_role (so a signed-in user's own RLS-scoped call is
-- safe), these two are only ever called from the server-side admin client in
-- src/lib/gmail/backfill.ts and src/app/api/backfill/step/route.ts — never
-- from the browser. There's no legitimate reason for `authenticated` (let
-- alone `anon`) to call them directly, so the fix is to revoke the default
-- grants and explicitly grant execute to service_role only.

revoke execute on function claim_backfill_job(uuid) from public, anon, authenticated;
grant execute on function claim_backfill_job(uuid) to service_role;

revoke execute on function increment_backfill_progress(uuid, integer, text, integer, backfill_status, text) from public, anon, authenticated;
grant execute on function increment_backfill_progress(uuid, integer, text, integer, backfill_status, text) to service_role;
