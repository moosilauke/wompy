-- Wompy migration 0004: grant table privileges to the Supabase API roles.
--
-- RLS decides WHICH ROWS a role may touch, but a role still needs base table
-- GRANTs to touch the table at all. Tables created through the Supabase UI get
-- these automatically; tables created by raw SQL (as 0001 did) do not — so every
-- PostgREST request failed with "permission denied for table email_accounts".
--
-- Grants mirror Supabase's own defaults:
--   anon / authenticated -> full DML, still constrained by the RLS policies
--                           defined in 0001 (auth.uid() = user_id).
--   service_role         -> full DML; bypasses RLS (used by the sync writer).
-- Sequence grants are included for completeness; our tables use uuid defaults
-- rather than serial, but this keeps future tables consistent.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public
  to anon, authenticated, service_role;

grant usage, select
  on all sequences in schema public
  to anon, authenticated, service_role;

grant execute
  on all functions in schema public
  to anon, authenticated, service_role;

-- Apply the same defaults to anything created later in this schema.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
