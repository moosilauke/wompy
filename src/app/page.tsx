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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/debug" : "/login");
}
