import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_SITE_URL } from "@/lib/env";

/**
 * Admin user operations.
 *
 * Every function here assumes the caller has already passed getAdminContext();
 * they do NOT re-check admin-ness, so they must only ever be reached from a
 * guarded route. They use the service role — listing all users, deleting
 * accounts, and resetting passwords are all admin-API operations that bypass
 * RLS by design.
 */

export interface AdminUser {
  id: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  /** The identity provider(s): "google", "email", etc. */
  providers: string[];
  /** The connected mailbox provider from email_accounts, if any. */
  mailProvider: string | null;
  isAdmin: boolean;
}

/**
 * List every user, newest first, with their profile and connected-mailbox info.
 *
 * Auth fields (created, last sign-in, provider) come from Supabase's auth admin
 * API; is_admin from profiles; the mail provider from email_accounts. Three
 * sources joined in memory because they live in different places.
 */
export async function listUsers(): Promise<AdminUser[]> {
  const admin = createAdminClient();

  // Auth records. Paginated; one page of 1000 is plenty for now, and the
  // signature makes it obvious where to add pagination when it isn't.
  const { data: authData, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw error;

  const users = authData.users;
  const ids = users.map((u) => u.id);

  const [{ data: profiles }, { data: accounts }] = await Promise.all([
    admin.from("profiles").select("id, is_admin").in("id", ids),
    admin.from("email_accounts").select("user_id, provider").in("user_id", ids),
  ]);

  const isAdminById = new Map(
    ((profiles ?? []) as { id: string; is_admin: boolean }[]).map((p) => [
      p.id,
      p.is_admin,
    ]),
  );
  const mailProviderById = new Map(
    ((accounts ?? []) as { user_id: string; provider: string }[]).map((a) => [
      a.user_id,
      a.provider,
    ]),
  );

  return users
    .map((u) => ({
      id: u.id,
      email: u.email ?? null,
      createdAt: u.created_at ?? null,
      lastSignInAt: u.last_sign_in_at ?? null,
      // listUsers() returns identities as null; the provider list lives in
      // app_metadata.providers (falling back to the singular `provider`).
      providers: providersOf(u.app_metadata),
      mailProvider: mailProviderById.get(u.id) ?? null,
      isAdmin: isAdminById.get(u.id) ?? false,
    }))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/** Login providers from a user's app_metadata, tolerant of either shape. */
function providersOf(meta: Record<string, unknown> | undefined): string[] {
  const list = meta?.providers;
  if (Array.isArray(list)) return list.filter((p): p is string => typeof p === "string");
  const single = meta?.provider;
  return typeof single === "string" ? [single] : [];
}

/** Count of current admins, for the last-admin guard. */
async function adminCount(): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_admin", true);
  return count ?? 0;
}

export class AdminActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminActionError";
  }
}

/**
 * Delete a user and everything they own.
 *
 * Guards: an admin can't delete their own account (locking themselves out
 * mid-action), and can't delete the last remaining admin (leaving the system
 * with none). auth.users deletion cascades to profiles, email_accounts,
 * messages, etc. via their foreign keys.
 */
export async function deleteUser(
  actingAdminId: string,
  targetUserId: string,
): Promise<void> {
  if (actingAdminId === targetUserId) {
    throw new AdminActionError("You can’t delete your own account here.");
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", targetUserId)
    .maybeSingle();

  if ((target as { is_admin: boolean } | null)?.is_admin) {
    if ((await adminCount()) <= 1) {
      throw new AdminActionError("Can’t delete the last admin.");
    }
  }

  const { error } = await admin.auth.admin.deleteUser(targetUserId);
  if (error) throw error;
}

/**
 * Grant or revoke admin.
 *
 * Guard: can't demote the last admin, so there's always at least one.
 */
export async function setAdmin(
  targetUserId: string,
  makeAdmin: boolean,
): Promise<void> {
  const admin = createAdminClient();

  if (!makeAdmin && (await adminCount()) <= 1) {
    // Only meaningful if the target is currently the (only) admin, but checking
    // the count is enough and avoids a race on the target's own flag.
    const { data: target } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", targetUserId)
      .maybeSingle();
    if ((target as { is_admin: boolean } | null)?.is_admin) {
      throw new AdminActionError("Can’t remove the last admin.");
    }
  }

  const { error } = await admin
    .from("profiles")
    .update({ is_admin: makeAdmin, updated_at: new Date().toISOString() })
    .eq("id", targetUserId);
  if (error) throw error;
}

/**
 * Send a password-reset email to a user.
 *
 * resetPasswordForEmail, NOT admin.generateLink: generateLink only RETURNS a
 * link for the caller to deliver itself — it does not send anything, so it
 * would silently produce a reset that never reaches the user. resetPasswordFor
 * Email sends through Supabase's configured mailer.
 *
 * For a Google-only account with no password this still sends a link that lets
 * them set one — harmless, and the admin isn't expected to know how each user
 * signed up. Delivery depends on the project having email configured; with the
 * default Supabase SMTP it's rate-limited, which matters once there are many
 * users (noted on the roadmap alongside the Resend transactional-email work).
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.auth.resetPasswordForEmail(email, {
    // PUBLIC_SITE_URL, not NEXT_PUBLIC_APP_URL: this goes into an EMAIL link, so
    // it must never be localhost. PUBLIC_SITE_URL falls back to the live domain.
    redirectTo: `${PUBLIC_SITE_URL}/login`,
  });
  if (error) throw error;
}
