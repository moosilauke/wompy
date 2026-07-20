-- Wompy migration 0002: generalize connected inboxes across email providers.
--
-- Auth (how you log into Wompy) and email connections (which inboxes Wompy reads)
-- are separate concerns. A user may sign in with email/password or with Google,
-- and independently connect one or more inboxes (Gmail now, Yahoo later). This
-- migration renames the Gmail-specific `gmail_accounts` table to a provider-generic
-- `email_accounts` and threads a `provider` column through.
--
-- Session-1 tables are empty in any real deploy, so ALTER ... RENAME is safe and
-- lets a dev who already ran 0001 migrate cleanly (no drop/recreate).

-- Provider of a connected inbox. Gmail is implemented; Yahoo is a placeholder so
-- the abstraction exists before its sync is built.
create type email_provider as enum ('gmail', 'yahoo');

-- --- Rename the table and generalize it -------------------------------------
alter table gmail_accounts rename to email_accounts;

alter table email_accounts
  add column provider email_provider not null default 'gmail';

-- Rename the child FK column on messages to match.
alter table messages rename column gmail_account_id to email_account_id;

-- --- Rename indexes carried over from 0001 (keep names consistent) ----------
alter index gmail_accounts_user_id_idx rename to email_accounts_user_id_idx;
alter index messages_account_date_idx  rename to messages_email_account_date_idx;

-- --- Rename the updated_at trigger ------------------------------------------
-- The trigger function set_updated_at() is unchanged; only the trigger name and
-- its target table reference need updating (the table rename already retargets it).
alter trigger gmail_accounts_set_updated_at on email_accounts
  rename to email_accounts_set_updated_at;

-- --- Re-point the RLS policy name for clarity -------------------------------
-- The policy still restricts rows to auth.uid() = user_id; just rename it.
alter policy "own gmail_accounts" on email_accounts
  rename to "own email_accounts";
