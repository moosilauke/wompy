-- Full-text search over messages.
--
-- 41% of stored mail is HTML-only (no text/plain part), so its readable text
-- exists only after conversion. Searching body_text alone would silently miss
-- those messages entirely. `search_text` holds the plain-text form for every
-- message: body_text when present, otherwise the converted HTML, written at
-- sync time by the application (see lib/gmail/sync.ts).
--
-- The tsvector is a GENERATED column rather than a trigger so it can never
-- drift from its source, and the GIN index over it keeps search fast as the
-- mailbox grows.
--
-- Subject and sender are woven into the same vector with weights, so a search
-- for a person's name ranks their messages above ones merely mentioning it:
--   A = subject, B = sender, C = body

alter table messages
  add column if not exists search_text text;

alter table messages
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(from_address, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(search_text, '')), 'C')
  ) stored;

create index if not exists messages_search_vector_idx
  on messages using gin (search_vector);

-- Contact lookup by name or address. pg_trgm supports partial matches, which
-- full-text search does not: typing "sar" should find Sarah before the word is
-- finished, since the people list is a lookup rather than a document search.
create extension if not exists pg_trgm;

create index if not exists contacts_search_trgm_idx
  on contacts using gin (
    (coalesce(display_name, '') || ' ' || address) gin_trgm_ops
  );
