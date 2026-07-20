import { createBrowserClient } from "@supabase/ssr";
import {
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_URL,
} from "@/lib/env";

/**
 * Browser-side Supabase client (anon key). Use inside Client Components.
 * Subject to Row Level Security — only ever sees the signed-in user's rows.
 */
export function createClient() {
  return createBrowserClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
