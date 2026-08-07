-- Wompy migration 0031: stats_summary — the "fun stats" page in one RPC.
--
-- One no-arg-shaped RPC (p_tz is a single string, not an array) computing
-- every stat in one query via CTEs, rather than the tab_counts pattern
-- (ROADMAP.md backlog already flags that one as three round-trips where one
-- would do). Also sidesteps the .in()-with-hundreds-of-ids hazard entirely
-- (migration 0030): nothing here takes an id array from the client at all.
--
-- security invoker so this still respects RLS as the calling user, same as
-- every other RPC in this file's lineage (0026, 0030).

-- The fastest-reply self-join matches mine.in_reply_to = theirs.message_id_header
-- across a user's whole mailbox — the one genuinely expensive part of this
-- RPC, and message_id_header has no index today.
create index if not exists messages_message_id_header_idx
  on messages (user_id, message_id_header)
  where trashed_at is null and is_reaction = false;

drop function if exists stats_summary(text);

create or replace function stats_summary(p_tz text default 'UTC')
returns table (
  total_conversations bigint,
  total_messages bigint,
  busiest_contact_address text,
  busiest_contact_name text,
  busiest_contact_count bigint,
  longest_thread_id uuid,
  longest_thread_span_days double precision,
  longest_thread_partner text,
  longest_thread_partner_name text,
  fastest_reply_seconds double precision,
  fastest_reply_thread_id uuid,
  fastest_reply_partner text,
  fastest_reply_partner_name text,
  peak_send_hour int,
  peak_send_hour_count bigint,
  oldest_ongoing_thread_id uuid,
  oldest_ongoing_started_at timestamptz,
  oldest_ongoing_partner text,
  oldest_ongoing_partner_name text,
  reactions_given bigint,
  reactions_received bigint
)
language sql
security invoker
set search_path = public
as $$
  with my_messages as (
    -- Base filter every stat reuses: real mail, not trashed, not a reaction
    -- carrier (a reaction is stored as its own message row but isn't "a
    -- message" for counting purposes).
    select m.*
    from messages m
    where m.trashed_at is null
      and m.is_reaction = false
  ),
  totals as (
    select
      (select count(*) from threads where tab in ('contact', 'company')) as total_conversations,
      (select count(*) from my_messages) as total_messages
  ),
  -- Busiest contact: every participant in every contact-tab thread gets
  -- credit for that thread's messages, including group threads (a group
  -- thread's messages count toward each participant, not just one). Company
  -- and spam tabs are excluded — this stat is about people, not vendors or
  -- quarantined senders. participant_set is already "everyone but me" (see
  -- threads.participant_set), so no self-exclusion needed here.
  busiest as (
    select p.address, count(*) as msg_count
    from threads t
    join my_messages m on m.thread_id = t.id
    cross join lateral unnest(t.participant_set) as p(address)
    where t.tab = 'contact'
    group by p.address
    order by msg_count desc
    limit 1
  ),
  -- Restricted to tab='contact', same as `busiest`: company-tab senders
  -- (receipts, newsletters, automated notifications) produced misleading
  -- winners here in testing — an 18-second "fastest reply" to a Google Play
  -- no-reply address, a 736-day "longest thread" that was really a Netflix
  -- notification thread. These three stats are specifically about people,
  -- so all three agree on the same tab filter. Span is measured only across
  -- messages actually from/to the thread's own participant_set (see
  -- fastest_reply for why: a company sender's message can land in an
  -- otherwise-contact thread without being a real participant).
  longest as (
    select t.id, max(m.internal_date) - min(m.internal_date) as span,
           t.participant_set[1] as partner
    from threads t
    join my_messages m on m.thread_id = t.id
    where t.tab = 'contact'
      and (
        m.from_canonical = any(t.participant_set)
        or 'SENT' = any(m.label_ids)
      )
    group by t.id, t.participant_set
    having count(*) > 1
    order by span desc
    limit 1
  ),
  -- A sent reply matched to the message it replied to via In-Reply-To ->
  -- Message-ID. Requires `mine` to carry SENT and `theirs` not to (so
  -- replying to your own earlier message, e.g. a follow-up, never wins), and
  -- requires mine.internal_date > theirs.internal_date as a sanity guard
  -- against clock skew or misordered headers producing a negative duration.
  -- `t.tab = 'contact'` alone isn't enough: a company sender's message can
  -- land in an otherwise-contact thread (e.g. a notification Gmail threads
  -- alongside a real exchange) without being in participant_set — confirmed
  -- in testing (an 18-second "fastest reply" to a Google Play address inside
  -- a thread whose only real participant was a person). Requiring theirs'
  -- sender to actually be in the thread's own participant_set closes that.
  -- Ties/near-ties aren't specially handled (order by ... limit 1 picks
  -- whichever Postgres visits first) — acceptable for a v1 fun stat.
  fastest_reply as (
    select
      extract(epoch from (mine.internal_date - theirs.internal_date)) as seconds,
      mine.thread_id,
      theirs.from_canonical as partner
    from my_messages mine
    join my_messages theirs
      on theirs.message_id_header = mine.in_reply_to
    join threads t on t.id = mine.thread_id
    where 'SENT' = any(mine.label_ids)
      and not ('SENT' = any(theirs.label_ids))
      and mine.internal_date > theirs.internal_date
      and t.tab = 'contact'
      and theirs.from_canonical = any(t.participant_set)
    order by seconds asc
    limit 1
  ),
  -- internal_date is stored UTC; p_tz (the browser's IANA timezone, passed by
  -- the client) is what makes "you're a night owl" mean something to the
  -- actual user instead of reporting a UTC hour that may not match their
  -- lived sense of "late at night." Defaults to UTC only if the caller omits
  -- it, which the client-side call never does.
  send_hours as (
    select extract(hour from m.internal_date at time zone p_tz) as hr, count(*) as cnt
    from my_messages m
    where 'SENT' = any(m.label_ids)
    group by hr
    order by cnt desc
    limit 1
  ),
  -- "Still going": started at least 90 days before its own last message (a
  -- genuinely long-running thread, not a burst of same-day back-and-forth),
  -- AND has had a message within the last 90 days (still alive, not
  -- dormant). Both windows are product choices, not derived facts.
  -- Restricted to tab='contact' (unlike `longest`, which allows company):
  -- "longest-running relationship" reads as a person, and a recurring vendor
  -- winning it looked wrong in testing, whereas the "longest conversation"
  -- card's framing tolerates a company either way.
  oldest_ongoing as (
    select t.id, min(m.internal_date) as started_at, t.participant_set[1] as partner
    from threads t
    join my_messages m on m.thread_id = t.id
    where t.tab = 'contact'
      and t.last_message_at > now() - interval '90 days'
    group by t.id, t.participant_set, t.last_message_at
    having t.last_message_at - min(m.internal_date) > interval '90 days'
    order by started_at asc
    limit 1
  ),
  -- Given vs received: the reacted-to message's own SENT label says whether
  -- I was the one reacting (I sent that reaction-carrying message) or the
  -- one being reacted to (someone else did). No address canonicalization
  -- needed — reactions.message_id is a direct FK to the carrier row.
  reaction_counts as (
    select
      count(*) filter (where 'SENT' = any(carrier.label_ids)) as given,
      count(*) filter (where not ('SENT' = any(carrier.label_ids))) as received
    from reactions r
    join messages carrier on carrier.id = r.message_id
  )
  select
    totals.total_conversations,
    totals.total_messages,
    busiest.address,
    busiest_contact.display_name,
    busiest.msg_count,
    longest.id,
    extract(epoch from longest.span) / 86400.0,
    longest.partner,
    longest_contact.display_name,
    fastest_reply.seconds,
    fastest_reply.thread_id,
    fastest_reply.partner,
    fastest_reply_contact.display_name,
    send_hours.hr::int,
    send_hours.cnt,
    oldest_ongoing.id,
    oldest_ongoing.started_at,
    oldest_ongoing.partner,
    oldest_ongoing_contact.display_name,
    coalesce(reaction_counts.given, 0),
    coalesce(reaction_counts.received, 0)
  from totals
  left join busiest on true
  left join contacts busiest_contact on busiest_contact.address = busiest.address
  left join longest on true
  left join contacts longest_contact on longest_contact.address = longest.partner
  left join fastest_reply on true
  left join contacts fastest_reply_contact on fastest_reply_contact.address = fastest_reply.partner
  left join send_hours on true
  left join oldest_ongoing on true
  left join contacts oldest_ongoing_contact on oldest_ongoing_contact.address = oldest_ongoing.partner
  left join reaction_counts on true;
$$;

grant execute on function stats_summary(text) to authenticated, service_role;
