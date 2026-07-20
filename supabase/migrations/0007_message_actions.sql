-- Wompy migration 0007: support message actions (starting with trash).
--
-- `trashed_at` mirrors Gmail's TRASH label locally so the UI can hide a message
-- the instant it's trashed, rather than waiting for the next sync to observe the
-- label change. Sync keeps it in step: `in:anywhere` returns trashed mail too, so
-- label_ids remains the source of truth and this column is the fast local view.
--
-- Nullable rather than a boolean so we retain WHEN it happened — useful for an
-- undo window and for any future "recently deleted" view.

alter table messages
  add column trashed_at timestamptz;

-- The app filters trashed mail out of every list, so this is on the hot path.
create index messages_not_trashed_idx
  on messages (user_id, internal_date desc)
  where trashed_at is null;
