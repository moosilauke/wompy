import "server-only";
import { google } from "googleapis";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { GMAIL_SCOPES } from "@/lib/email/providers";
import type { EmailAccount } from "@/lib/types";

/** The OAuth2 client type as produced by `google.auth.OAuth2`. Using this
 * (rather than importing OAuth2Client from google-auth-library directly) keeps
 * it compatible with `google.gmail({ auth })`, which resolves the type through
 * googleapis' own nested copy of google-auth-library. */
type GoogleOAuth2Client = InstanceType<typeof google.auth.OAuth2>;

// Re-export so existing importers of GMAIL_SCOPES keep working.
export { GMAIL_SCOPES };

/** A bare OAuth2 client configured with our app credentials. */
export function createOAuthClient(): GoogleOAuth2Client {
  return new google.auth.OAuth2(
    serverEnv.googleClientId,
    serverEnv.googleClientSecret,
    serverEnv.googleRedirectUri,
  );
}

/** Build the Google consent URL. `state` carries the app user id through the
 * round-trip so the callback can attribute the tokens.
 *
 * `prompt: consent` is kept HERE, unlike the sign-in path, because this is the
 * deliberate "connect my mailbox" action: Google omits the refresh_token on
 * re-authorization, and this flow exists precisely to (re)establish one. A user
 * reaching this screen asked to connect Gmail, so a permission prompt is
 * expected rather than friction. */
export function buildConsentUrl(state: string): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    include_granted_scopes: true,
    state,
  });
}

/** Google token fields we persist. Shape matches both googleapis' `getToken`
 * result and the tokens extracted from a Supabase Google-auth session. */
export interface GoogleTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}

/**
 * Upsert a Gmail `email_accounts` row for a user from a set of Google tokens.
 *
 * Shared by BOTH connect paths: the explicit "Connect Gmail" callback and the
 * combined Google-auth signup callback. On re-consent Google may omit the
 * refresh_token, so we only overwrite it when present (keeps the stored one).
 */
export async function upsertGoogleTokensForUser(
  userId: string,
  email: string,
  tokens: GoogleTokens,
): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin.from("email_accounts").upsert(
    {
      user_id: userId,
      provider: "gmail",
      email,
      access_token: tokens.access_token ?? null,
      ...(tokens.refresh_token
        ? { refresh_token: tokens.refresh_token }
        : {}),
      token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
    },
    { onConflict: "user_id,email" },
  );
  return { error: error ? error.message : null };
}

/** Read the Gmail address for a set of Google credentials via the Gmail profile. */
export async function fetchGmailAddress(
  tokens: GoogleTokens,
): Promise<string | null> {
  const oauth = createOAuthClient();
  oauth.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth });
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress ?? null;
}

/**
 * Return an OAuth2 client authorized for a stored Gmail account, refreshing the
 * access token if it has expired (or is about to) and persisting the new token.
 * Used by the sync writer.
 */
export async function getAuthorizedClient(
  account: EmailAccount,
): Promise<GoogleOAuth2Client> {
  const client = createOAuthClient();
  client.setCredentials({
    access_token: account.access_token ?? undefined,
    refresh_token: account.refresh_token ?? undefined,
    expiry_date: account.token_expiry
      ? new Date(account.token_expiry).getTime()
      : undefined,
  });

  const expiresSoon =
    !account.token_expiry ||
    new Date(account.token_expiry).getTime() - Date.now() < 60_000;

  if (expiresSoon) {
    // No refresh token and an expired access token is unrecoverable — the user
    // has to grant access again. Say so rather than proceeding with a dead
    // token and failing later as an opaque Gmail error.
    if (!account.refresh_token) {
      throw new GmailReauthRequiredError(
        "Gmail access needs to be reconnected.",
      );
    }

    try {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);

      const admin = createAdminClient();
      await admin
        .from("email_accounts")
        .update({
          access_token: credentials.access_token ?? account.access_token,
          token_expiry: credentials.expiry_date
            ? new Date(credentials.expiry_date).toISOString()
            : account.token_expiry,
        })
        .eq("id", account.id);
    } catch (err) {
      // `invalid_grant` means the refresh token is dead: revoked from Google's
      // account page, password changed, or expired through disuse. No amount of
      // retrying fixes it — only re-consent does.
      if (isInvalidGrant(err)) {
        throw new GmailReauthRequiredError(
          "Gmail access was revoked or expired. Reconnect to resume syncing.",
        );
      }
      throw err;
    }
  }

  return client;
}

/**
 * Raised when a Gmail account can only be recovered by the user re-granting
 * access. Callers surface a "Reconnect Gmail" affordance instead of a generic
 * sync failure.
 */
export class GmailReauthRequiredError extends Error {
  readonly code = "gmail_reauth_required";

  constructor(message: string) {
    super(message);
    this.name = "GmailReauthRequiredError";
  }
}

/** Google signals a dead refresh token with an `invalid_grant` error. */
function isInvalidGrant(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as {
    message?: string;
    response?: { data?: { error?: string } };
  };
  return (
    candidate.response?.data?.error === "invalid_grant" ||
    (candidate.message ?? "").includes("invalid_grant")
  );
}
