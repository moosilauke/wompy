-- Exclude spam from search.
--
-- Spam is quarantined to its own tab precisely so it stays out of the way; it
-- shouldn't resurface in search results. Both search functions now filter it
-- out — people by the contact's tab, messages by their thread's tab.
--
-- For messages the join is a LEFT JOIN, so an unthreaded message has a null
-- tab; `t.tab is distinct from 'spam'` keeps those (null is not spam) while
-- excluding actual spam.

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
    (
      select t.id from threads t
      where t.user_id = p_user_id
        and c.address = any(t.participant_set)
        and t.tab is distinct from 'spam'
      order by t.last_message_at desc nulls last
      limit 1
    ) as thread_id
  from contacts c
  where c.user_id = p_user_id
    and c.tab is distinct from 'spam'
    and p_query <> ''
    and (coalesce(c.display_name, '') || ' ' || c.address) ilike '%' || p_query || '%'
  order by
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
    and t.tab is distinct from 'spam'
    and p_query <> ''
    and m.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc, m.internal_date desc
  limit p_limit;
$$;

grant execute on function public.search_contacts(uuid, text, integer) to authenticated, service_role;
grant execute on function public.search_messages(uuid, text, integer) to authenticated, service_role;
