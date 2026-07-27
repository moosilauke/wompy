-- Wompy migration 0018: canonical sender address on messages.
--
-- `messages.from_address` is the raw header ("Name <addr@example.com>"), while
-- `contacts.address` is the parsed, canonicalized bare address (dots/+tags
-- stripped per canonicalAddress() in src/lib/email/addresses.ts). There was no
-- way to filter messages by "belongs to this contact" at the SQL level without
-- re-parsing every row's header client-side.
--
-- This column lets classify-run.ts scope its message read to specific contacts
-- (see ClassifyScope) instead of always scanning the whole mailbox — the
-- prerequisite for historical sync not making every routine poll slower as a
-- user's message count grows into the tens of thousands.
--
-- Populated by the app (mapMessageToRow in src/lib/gmail/sync.ts) going
-- forward; existing rows are backfilled by scripts/backfill-from-canonical.mjs
-- since canonicalization is app logic (per-domain dot/plus rules), not
-- expressible as a portable generated SQL column.

alter table messages
  add column from_canonical text;

create index messages_user_from_canonical_idx
  on messages (user_id, from_canonical);
