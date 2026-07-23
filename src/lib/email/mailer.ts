import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * Transactional email via the Mailtrap Email API.
 *
 * This is only for email WE originate (e.g. the welcome message). Supabase still
 * owns its own confirmation and password-reset flows — those generate secure
 * tokens and are delivered through Supabase's SMTP, which is pointed at Mailtrap
 * in the dashboard. We deliberately don't reinvent those token flows here.
 *
 * https://send.api.mailtrap.io/api/send
 */

const MAILTRAP_ENDPOINT = "https://send.api.mailtrap.io/api/send";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** Set when the send was skipped or failed; for logging, not the user. */
  reason?: string;
}

/**
 * Send one transactional email.
 *
 * Never throws: a failed transactional send should not break the flow that
 * triggered it (a signup must succeed even if the welcome email doesn't). The
 * result carries the outcome for logging. When Mailtrap isn't configured (local
 * dev, previews), it no-ops rather than erroring.
 */
export async function sendTransactionalEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  if (!serverEnv.isMailConfigured) {
    return { ok: false, reason: "mail_not_configured" };
  }

  try {
    const res = await fetch(MAILTRAP_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serverEnv.mailtrapApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: {
          email: serverEnv.mailFromEmail,
          name: serverEnv.mailFromName,
        },
        to: [{ email: input.to }],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, reason: `mailtrap_${res.status}: ${detail.slice(0, 200)}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}
