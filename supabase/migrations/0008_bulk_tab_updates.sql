-- Bulk tab updates for classification.
--
-- Classification previously wrote one row at a time: ~150ms per round-trip to
-- the hosted endpoint, ~3.4s for 22 contacts plus ~3.4s for 22 threads, on
-- every sync (every 2 minutes) and growing linearly with the mailbox.
--
-- Batching via PostgREST `upsert` is NOT a valid fix here: upsert compiles to
-- INSERT ... ON CONFLICT, which builds a whole new row and nulls any column the
-- caller omits. Partial upserts either fail on NOT NULL columns (as user_id
-- did) or silently destroy data on nullable ones.
--
-- These functions do a genuine bulk UPDATE ... FROM in a single statement,
-- touching only the named columns and leaving every other column untouched.
--
-- Both are scoped to the calling user's rows via an explicit user_id argument
-- and SECURITY INVOKER, so RLS still applies.

create or replace function public.apply_contact_tabs(
  p_user_id uuid,
  p_updates jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  update contacts c
     set tab = u.tab,
         classification_signals = u.classification_signals
    from (
      select (value->>'id')::uuid              as id,
             (value->>'tab')::contact_tab      as tab,
             value->'classification_signals'   as classification_signals
        from jsonb_array_elements(p_updates)
    ) u
   where c.id = u.id
     and c.user_id = p_user_id;

  get diagnostics updated = row_count;
  return updated;
end;
$$;

create or replace function public.apply_thread_tabs(
  p_user_id uuid,
  p_updates jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  update threads t
     set tab = u.tab
    from (
      select (value->>'id')::uuid        as id,
             (value->>'tab')::contact_tab as tab
        from jsonb_array_elements(p_updates)
    ) u
   where t.id = u.id
     and t.user_id = p_user_id;

  get diagnostics updated = row_count;
  return updated;
end;
$$;

grant execute on function public.apply_contact_tabs(uuid, jsonb) to authenticated, service_role;
grant execute on function public.apply_thread_tabs(uuid, jsonb) to authenticated, service_role;
