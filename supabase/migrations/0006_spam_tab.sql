-- Wompy migration 0006: give spam a home.
--
-- Gmail's SPAM label already flows into `messages.label_ids` (added in 0005), but
-- nothing consumed it, so spam leaked into the Contacts and Companies tabs.
--
-- Spam gets its own tab rather than being deleted or filtered out at sync time:
-- spam classification has false positives, and a genuine message wrongly flagged
-- by Gmail must still be findable inside Wompy. Nothing is ever auto-deleted.

alter type contact_tab add value if not exists 'spam';
