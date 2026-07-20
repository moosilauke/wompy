import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NEXT_PUBLIC_SUPABASE_URL, serverEnv } from "@/lib/env";

/**
 * Service-role Supabase client. BYPASSES Row Level Security — used only by the
 * Gmail sync writer, which must insert rows on behalf of a user from a trusted
 * server context. Never import this into anything that reaches the browser.
 *
 * `server-only` makes the build fail if this module is imported client-side.
 */
export function createAdminClient() {
  return createSupabaseClient(
    NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.supabaseSecretKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
