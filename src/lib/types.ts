/** Shared row shapes for Wompy's Supabase tables. Hand-written for now; can be
 * replaced by `supabase gen types` output once the CLI is wired up. */

export type ContactTab = "contact" | "company";

export interface ThreadRow {
  id: string;
  user_id: string;
  participant_set: string[];
  participant_key: string;
  tab: ContactTab;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactRow {
  id: string;
  user_id: string;
  address: string;
  display_name: string | null;
  tab: ContactTab;
  manually_overridden: boolean;
  classification_signals: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Provider of a connected inbox. Matches the `email_provider` enum in the DB. */
export type EmailProvider = "gmail" | "yahoo";

export interface EmailAccount {
  id: string;
  user_id: string;
  provider: EmailProvider;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
  history_id: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  user_id: string;
  email_account_id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  from_address: string | null;
  to_addresses: string[] | null;
  cc_addresses: string[] | null;
  subject: string | null;
  message_id_header: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  internal_date: string | null;
  raw_headers: Record<string, string>;
  thread_id: string | null;
  created_at: string;
}
