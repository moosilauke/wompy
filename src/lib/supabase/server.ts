import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_URL,
} from "@/lib/env";

/**
 * Server-side Supabase client (anon key) bound to the request's cookies, so it
 * acts as the signed-in user and is subject to Row Level Security. Use in
 * Server Components, Server Actions, and Route Handlers.
 *
 * `cookies()` is async in Next.js 16, hence this is an async factory.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` was called from a Server Component, where writing cookies
            // is not allowed. Safe to ignore when proxy.ts refreshes sessions.
          }
        },
      },
    },
  );
}
