-- User profiles, with an admin flag.
--
-- The admin panel needs a per-user record it owns (auth.users is Supabase's and
-- shouldn't be extended directly). For now it carries just the admin bit; a
-- profile page will add display preferences later.
--
-- is_admin is the single source of truth for admin access. It is checked
-- server-side against the VERIFIED JWT's user id on every admin request, never
-- trusted from the client. RLS lets a user read their OWN profile (so the app
-- can show/hide the Admin menu item) but NOT write it — admin changes go through
-- the service role after a server-side admin check, so a user can't escalate
-- themselves by updating their own row.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- A user may read only their own profile. This is what the app uses to decide
-- whether to render the Admin entry point at all.
create policy "profiles_select_own"
  on profiles for select
  using (auth.uid() = id);

-- No insert/update/delete policies for authenticated: all writes go through the
-- service role. Without a permissive policy, RLS denies these by default, so a
-- user cannot set their own is_admin = true.

grant select on profiles to authenticated;
grant all on profiles to service_role;

-- Backfill a profile for every existing user, so the panel's list is complete
-- from the first load.
insert into profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- Seed the first admin. Scoped by email so it only ever grants the intended
-- account, and idempotent.
update profiles p
set is_admin = true, updated_at = now()
from auth.users u
where u.id = p.id and u.email = 'kevincole@gmail.com';

-- Keep profiles in step with auth.users: a new signup gets a profile row
-- automatically, so the panel never shows a user without one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
