-- Attachment metadata.
--
-- Metadata only, no bytes: Gmail already stores the files, and `attachment_id`
-- is a durable handle for fetching them on demand. Copying 40 PDFs into
-- Supabase Storage would duplicate data, slow every sync, and add a quota to
-- worry about, for no capability the user notices.
--
-- Inline parts (logos, tracking pixels, signature graphics) are filtered at
-- ingest rather than stored and hidden later: across a 40-message sample, 22 of
-- 77 filename-bearing parts were inline, which would put a paperclip on nearly
-- every newsletter.

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,

  -- Gmail's handle for the bytes. Long-lived, but scoped to its message, so
  -- both ids are needed to fetch.
  gmail_attachment_id text not null,
  filename text not null,
  mime_type text,
  size_bytes integer,

  created_at timestamptz not null default now(),

  -- Re-syncing a message must not duplicate its attachments. Filename is part
  -- of the key because a message can legitimately carry several files, and
  -- Gmail's attachment ids are not stable across re-fetches of the same
  -- message.
  unique (message_id, filename, size_bytes)
);

create index if not exists attachments_message_idx on attachments (message_id);
create index if not exists attachments_user_idx on attachments (user_id);

alter table attachments enable row level security;

-- Same posture as every other table: users see only their own rows, and the
-- service role (the sync writer) bypasses RLS.
create policy "attachments_select_own"
  on attachments for select
  using (auth.uid() = user_id);

grant select on attachments to authenticated;
grant all on attachments to service_role;
