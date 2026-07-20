import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isSupabaseConfigured,
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_URL,
} from "@/lib/env";

/**
 * Next.js 16 Proxy (formerly `middleware`). Refreshes the Supabase auth session
 * on every matched request so Server Components always see a valid session, and
 * gates the authenticated app routes, redirecting signed-out users to /login.
 *
 * Follows the standard @supabase/ssr cookie-sync pattern: cookies read from the
 * request, writes mirrored onto BOTH the request (for downstream reads) and the
 * response (sent to the browser).
 */

// Routes that require an authenticated user.
const PROTECTED_PREFIXES = ["/debug", "/app"];
// Auth routes a signed-in user should be redirected away from.
const AUTH_ROUTES = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Before credentials are configured, don't touch Supabase — let the app boot
  // so the developer can see it's alive (auth pages show a "configure me" note).
  if (!isSupabaseConfigured) return response;

  const supabase = createServerClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getClaims()/getUser() must be called to trigger token refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAuthRoute = AUTH_ROUTES.some((p) => pathname.startsWith(p));

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/debug";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on all paths except static assets and image optimization. API routes
  // are included so Route Handlers get a refreshed session too.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
