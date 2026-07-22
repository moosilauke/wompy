import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The single gate for admin access.
 *
 * Every admin surface — the page, the API routes — calls this first. It reads
 * the user id from the VERIFIED JWT (getClaims validates the signature locally),
 * then confirms `profiles.is_admin` for that id. The client is never trusted to
 * say who it is or whether it's an admin.
 *
 * The is_admin lookup uses the service-role client so it doesn't depend on the
 * caller's own RLS grants — the check must not be defeatable by a user who has
 * somehow lost read access to their own row.
 */

export interface AdminContext {
  userId: string;
  email: string | null;
}

/**
 * Returns the admin context if the caller is a signed-in admin, otherwise null.
 * Callers decide how to respond to null (a page renders notFound(), an API
 * returns 404) — never leaking that the distinction is about admin-ness.
 */
export async function getAdminContext(): Promise<AdminContext | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data || !(data as { is_admin: boolean }).is_admin) {
    return null;
  }

  const email = claims?.claims?.email;
  return {
    userId,
    email: typeof email === "string" ? email : null,
  };
}

/**
 * Whether the current user is an admin. A lightweight boolean for the app shell
 * to decide if the Admin menu item should exist at all. Uses the user's own
 * (RLS-scoped) read of their profile — they can read their own row, so this
 * needs no elevated client.
 */
export async function currentUserIsAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return false;

  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();

  return Boolean((data as { is_admin: boolean } | null)?.is_admin);
}
