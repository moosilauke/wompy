-- Wompy migration 0005: capture Gmail labels and support the classifier.
--
-- Two additions:
--
-- 1. `messages.label_ids` — Gmail's labelIds for the message. Sync now includes
--    SENT mail (`in:anywhere`), so we need a reliable way to tell "I sent this"
--    from "I received this". Matching the From address by string is brittle
--    (aliases, +suffixes, display-name noise); the SENT label is authoritative.
--
-- 2. An index on `contacts.tab`, since the two-tab split filters by it on every
--    render of the app shell.

alter table messages
  add column label_ids text[] not null default '{}';

-- Fast lookups for "did I send this?" checks during classification.
create index messages_label_ids_idx on messages using gin (label_ids);

create index contacts_tab_idx on contacts (user_id, tab);

-- Threads carry a tab too (derived from their participants' classification) so
-- the rail can filter without joining through contacts on every query.
create index threads_tab_idx on threads (user_id, tab);
