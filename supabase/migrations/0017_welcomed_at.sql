-- Track whether a user has been sent the welcome email.
--
-- Signup happens on two paths (Google OAuth callback; email/password), and the
-- OAuth callback fires on EVERY login, not just the first. `welcomed_at` is the
-- idempotency guard: the welcome send is attempted only when it's null, then set
-- once, so a genuinely-new user gets exactly one welcome regardless of path or
-- how many times they log in.

alter table profiles
  add column if not exists welcomed_at timestamptz;

-- Existing users have already been around; mark them welcomed so the switch
-- doesn't email everyone.
update profiles set welcomed_at = now() where welcomed_at is null;
