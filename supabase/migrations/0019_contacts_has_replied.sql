-- Wompy migration 0019: incremental reply-reciprocity flag on contacts.
--
-- classify-run.ts's reply-reciprocity rule ("if you ever replied to them,
-- they're a Contact") previously re-derived this every single run by scanning
-- every sent message the user has ever written — an unavoidable full-mailbox
-- scan regardless of how narrowly everything else was scoped (see migration
-- 0018 and the ClassifyScope work in classify-run.ts).
--
-- This column is maintained incrementally instead: groupMessagesIntoThreads
-- (src/lib/email/threading.ts) sets it to true the moment a self-authored
-- message to/cc'ing a contact is ingested. One-way flag — once true, it is
-- never written back to false, since a reply, once sent, is permanent history.
-- classify-run.ts reads it directly rather than scanning sent mail.

alter table contacts
  add column has_replied boolean not null default false;
