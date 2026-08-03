-- Wompy migration 0028: ranked recipient suggestions for net-new compose.
--
-- The compose box previously offered contacts in alphabetical order, which put
-- whoever happens to sort first in front of the user rather than whoever they
-- actually write to. Worse, alphabetical-by-address meant junk entries created
-- by a header-parsing bug ('"cosgrave', '"bennett' — display-name fragments
-- from mis-split "Lastname, Firstname" headers) sorted to the very top, so the
-- default view of the modal was three malformed rows.
--
-- The parsing bug is fixed separately, in the sync path. This RPC fixes the
-- ordering: the default list should be the people you correspond with most.
--
-- Ranking, in order:
--   1. Contacts (real people) before Companies. Spam is excluded entirely —
--      the compose box must never help someone write to an address they
--      quarantined.
--   2. Whether the user has ever replied to them (contacts.has_replied) — the
--      strongest available signal of a real two-way relationship, and already
--      maintained incrementally at ingest.
--   3. Thread count. Recency alone surfaces one-off senders (a support ticket,
--      an unsubscribe confirmation); volume is what distinguishes a
--      correspondent from a sender.
--   4. Most recent activity, breaking ties among equally-frequent contacts.
--
-- Addresses without an '@' are filtered out defensively: the parser now
-- rejects them at ingest, but rows predating that fix are still in the table
-- and must not be offered as recipients.

create or replace function contact_suggestions(p_limit int default 500)
returns table (
  address text,
  display_name text,
  tab contact_tab,
  thread_count bigint,
  last_activity timestamptz
)
language sql
security invoker
set search_path = public
as $$
  select
    c.address,
    c.display_name,
    c.tab,
    count(distinct t.id) as thread_count,
    max(t.last_message_at) as last_activity
  from contacts c
  -- LEFT so a contact with no thread yet (freshly ingested, not yet grouped)
  -- still appears, just ranked last.
  left join threads t
    on c.address = any(t.participant_set)
   and t.user_id = c.user_id
  where c.tab <> 'spam'
    and c.address like '%@%'
  group by c.address, c.display_name, c.tab, c.has_replied
  order by
    (c.tab = 'contact') desc,
    c.has_replied desc,
    count(distinct t.id) desc,
    max(t.last_message_at) desc nulls last
  limit p_limit;
$$;

grant execute on function contact_suggestions(int) to authenticated, service_role;
