-- Wompy migration 0030: thread_reads and contacts lookups scoped via RPC.
--
-- Both were fetched with `.in("id", [...])` against a page of up to
-- RAIL_PAGE_SIZE*3 (600) thread ids / addresses. PostgREST builds that filter
-- into the request URL, and at 600 uuids the URL runs ~23,500 characters —
-- past undici's ~16KB header limit. The request throws HeadersOverflowError
-- before it ever reaches Postgres, and because every call site here
-- destructures only `{ data }` (never `error`), the failure was silent:
-- `data` came back undefined, `?? []` made it look like "no read state for
-- anyone," and every thread rendered unread. Reproduced locally (undici's
-- limit is stricter than whatever proxy prod sits behind); the underlying
-- DB and RLS were always correct.
--
-- Same fix as migration 0026 (latest_thread_snippets): move the id list into
-- an RPC's request body instead of the URL. security invoker so this still
-- respects thread_reads_select_own / RLS, not a service-role bypass.

create or replace function thread_reads_for(p_thread_ids uuid[])
returns table (thread_id uuid, last_read_at timestamptz)
language sql
security invoker
set search_path = public
as $$
  select tr.thread_id, tr.last_read_at
  from thread_reads tr
  where tr.thread_id = any(p_thread_ids)
    and tr.user_id = auth.uid();
$$;

grant execute on function thread_reads_for(uuid[]) to authenticated, service_role;

create or replace function contacts_for(p_addresses text[])
returns table (address text, display_name text)
language sql
security invoker
set search_path = public
as $$
  select c.address, c.display_name
  from contacts c
  where c.address = any(p_addresses)
    and c.user_id = auth.uid();
$$;

grant execute on function contacts_for(text[]) to authenticated, service_role;
