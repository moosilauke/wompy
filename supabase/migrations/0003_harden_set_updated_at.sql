-- Wompy migration 0003: pin search_path on set_updated_at().
--
-- Supabase's database linter flags functions with a mutable search_path
-- (lint 0011_function_search_path_mutable): without an explicit search_path, a
-- caller could shadow objects the function resolves at runtime. set_updated_at()
-- only touches the NEW record, so the risk is minimal, but pinning it is free.
--
-- `set search_path = ''` forces fully-qualified resolution inside the function.
-- The body references no schema objects, so nothing else needs changing.

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
