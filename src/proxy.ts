import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isSupabaseConfigured,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
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

// Routes that require an authenticated user. `/admin` is additionally gated by
// an is-admin check inside the page itself (which 404s non-admins); the proxy
// only ensures they're signed in first.
const PROTECTED_PREFIXES = ["/debug", "/app", "/admin"];
// Auth routes a signed-in user should be redirected away from.
const AUTH_ROUTES = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { pathname } = request.nextUrl;

  // The landing page is public and statically rendered. An ANONYMOUS visitor —
  // no Supabase auth cookie — skips the session work entirely, keeping first
  // paint off the auth path on the page where a slow response costs the most.
  //
  // A visitor who DOES carry an auth cookie falls through to the normal session
  // check below, which redirects them to /app: a signed-in user shouldn't land
  // on the marketing page. The cost of the check is paid only by people who are
  // (probably) signed in, never by first-time visitors.
  if (pathname === "/" && !hasAuthCookie(request)) {
    return response;
  }

  // Before credentials are configured, don't touch Supabase — let the app boot
  // so the developer can see it's alive (auth pages show a "configure me" note).
  if (!isSupabaseConfigured) return response;

  const supabase = createServerClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
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

  // IMPORTANT: this call must happen to trigger token refresh.
  //
  // getClaims() rather than getUser(): getUser() makes a network round-trip to
  // the auth server on EVERY request to validate the token (~120ms measured,
  // against a ~21ms REST baseline). getClaims() verifies the JWT signature
  // locally against cached JWKS, and this project signs with ES256 (asymmetric),
  // so no network call is needed. It still refreshes an expired session.
  const {
    data: claims,
  } = await supabase.auth.getClaims();
  const user = claims?.claims ?? null;

  // A signed-in user on the landing page goes straight to the app. (An
  // anonymous visitor never reaches here — they were returned above before any
  // session work. A stale/invalid cookie leaves `user` null, so they correctly
  // stay on the landing page.)
  if (pathname === "/" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

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
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

/**
 * Whether the request carries a Supabase auth cookie.
 *
 * @supabase/ssr stores the session in a cookie named `sb-<ref>-auth-token`
 * (chunked as `…-auth-token.0`, `.1` when large). A cheap prefix/suffix check is
 * enough to distinguish "possibly signed in" from "definitely anonymous" — the
 * cookie's validity is confirmed by getClaims afterward, so a forged or stale
 * cookie just falls through to the normal null-user handling.
 */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(
      (c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"),
    );
}

export const config = {
  // Run on all paths except static assets and image optimization. API routes
  // are included so Route Handlers get a refreshed session too.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
