-- Search entry points.
--
-- Two functions rather than one, because the result shapes differ: people are
-- looked up by partial name (typing "sar" should find Sarah), while messages
-- are searched as documents with stemming and relevance ranking.
--
-- SECURITY INVOKER with an explicit user_id predicate, so RLS applies.

create or replace function public.search_contacts(
  p_user_id uuid,
  p_query text,
  p_limit integer default 5
)
returns table (
  address text,
  display_name text,
  tab contact_tab,
  thread_id uuid
)
language sql
security invoker
set search_path = public
as $$
  select
    c.address,
    c.display_name,
    c.tab,
    -- The conversation to open when this person is picked. A contact can appear
    -- in several threads (group mail); the most recent is the useful one.
    (
      select t.id from threads t
      where t.user_id = p_user_id
        and c.address = any(t.participant_set)
      order by t.last_message_at desc nulls last
      limit 1
    ) as thread_id
  from contacts c
  where c.user_id = p_user_id
    and p_query <> ''
    and (coalesce(c.display_name, '') || ' ' || c.address) ilike '%' || p_query || '%'
  order by
    -- Prefer a prefix match on the display name: typing "sar" should rank
    -- "Sarah Beddow" above someone whose address merely contains "sar".
    (coalesce(c.display_name, '') ilike p_query || '%') desc,
    (c.address ilike p_query || '%') desc,
    c.tab = 'contact' desc,
    coalesce(c.display_name, c.address)
  limit p_limit;
$$;

create or replace function public.search_messages(
  p_user_id uuid,
  p_query text,
  p_limit integer default 20
)
returns table (
  id uuid,
  thread_id uuid,
  from_address text,
  subject text,
  snippet text,
  internal_date timestamptz,
  tab contact_tab,
  rank real
)
language sql
security invoker
set search_path = public
as $$
  select
    m.id,
    m.thread_id,
    m.from_address,
    m.subject,
    -- A window of the body around the hit, so a result shows why it matched
    -- rather than just the message's opening line.
    ts_headline(
      'english',
      coalesce(m.search_text, m.snippet, ''),
      websearch_to_tsquery('english', p_query),
      'MaxWords=22, MinWords=8, ShortWord=3, MaxFragments=1, StartSel=<<, StopSel=>>'
    ) as snippet,
    m.internal_date,
    t.tab,
    ts_rank(m.search_vector, websearch_to_tsquery('english', p_query)) as rank
  from messages m
  left join threads t on t.id = m.thread_id
  where m.user_id = p_user_id
    and m.trashed_at is null
    and p_query <> ''
    and m.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc, m.internal_date desc
  limit p_limit;
$$;

grant execute on function public.search_contacts(uuid, text, integer) to authenticated, service_role;
grant execute on function public.search_messages(uuid, text, integer) to authenticated, service_role;
