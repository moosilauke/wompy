import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Root route. For this backend-foundation session it simply routes into the app:
 * signed-in users go to the debug view, everyone else to login. The designed
 * landing page (which doubles as the app shell) is a later session.
 */
export default async function Home() {
  // Before credentials are configured, send to login, which shows a setup note.
  if (!isSupabaseConfigured) redirect("/login");

  const supabase = await createClient();
  // Local JWT verification rather than an auth-server round-trip; this is just
  // a routing decision, and the destination re-checks anyway.
  const { data: claims } = await supabase.auth.getClaims();

  redirect(claims?.claims ? "/app" : "/login");
}
