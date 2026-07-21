/**
 * Centralized environment-variable access with clear errors when a value is
 * missing. Import from here instead of reading `process.env` inline so a missing
 * placeholder fails loudly (and in one place) rather than silently.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

// Public (safe to expose to the browser).
// Supabase's publishable key (sb_publishable_...) — the current name for what was
// formerly the "anon" key. Client- and server-SSR clients use it under RLS.
export const NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const NEXT_PUBLIC_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** True once the Supabase public env vars are present. Lets the app boot (and
 * show a "configure me" message) before credentials are filled in, instead of
 * crashing on every request. */
export const isSupabaseConfigured =
  NEXT_PUBLIC_SUPABASE_URL.length > 0 &&
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.length > 0;

/** Server-only secrets. Never import these into client components. */
export const serverEnv = {
  // Supabase's secret key (sb_secret_...) — the current name for what was formerly
  // the "service_role" key. Used only by the admin client, which bypasses RLS.
  get supabaseSecretKey() {
    return required(
      "SUPABASE_SECRET_KEY",
      process.env.SUPABASE_SECRET_KEY,
    );
  },
  get googleClientId() {
    return required("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID);
  },
  get googleClientSecret() {
    return required("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET);
  },
  get googleRedirectUri() {
    return required("GOOGLE_REDIRECT_URI", process.env.GOOGLE_REDIRECT_URI);
  },
  /**
   * 32-byte key (base64 or hex) encrypting OAuth tokens at rest. Must live
   * outside the database — its whole purpose is that a database compromise
   * alone doesn't yield usable mailbox credentials.
   *
   * Generate with: openssl rand -base64 32
   */
  get tokenEncryptionKey() {
    return required(
      "TOKEN_ENCRYPTION_KEY",
      process.env.TOKEN_ENCRYPTION_KEY,
    );
  },
};
