import "server-only";
import { PUBLIC_SITE_URL } from "@/lib/env";
import { sendTransactionalEmail, type SendEmailResult } from "@/lib/email/mailer";

/**
 * Transactional email templates and their send helpers.
 *
 * Kept separate from the mailer transport so the copy and markup live in one
 * place. HTML is inlined and table-based — the lowest common denominator that
 * renders across email clients, which strip <style> blocks and ignore flexbox.
 */

// Brand colors, inlined because email clients don't honour CSS variables.
const SPRUCE = "#1d4a45";
const CORAL = "#e2725a";
const CREAM = "#fdfbf7";
const TEXT = "#2c2a24";
const MUTED = "#6b6558";

/**
 * Send the welcome email after signup.
 *
 * This is genuinely ours to own — it fires when a new account is created, has no
 * secure token, and isn't something Supabase sends. Never throws (see mailer).
 */
export async function sendWelcomeEmail(to: string): Promise<SendEmailResult> {
  const appUrl = PUBLIC_SITE_URL;

  const text = [
    "Welcome to Wompy 👋",
    "",
    "Your inbox, as one long conversation. No threads to untangle, no subject",
    "lines, no signatures — just the people you talk to.",
    "",
    `Open Wompy: ${appUrl}/app`,
    "",
    "If you signed up with Google, your Gmail is already connecting. Otherwise,",
    "connect it from the app to start syncing.",
    "",
    "— The Wompy team",
  ].join("\n");

  const html = wrapEmail(`
    <tr><td style="padding: 0 0 8px;">
      <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: ${TEXT};">
        Welcome to Wompy 👋
      </h1>
    </td></tr>
    <tr><td style="padding: 0 0 20px;">
      <p style="margin: 0; font-size: 15px; line-height: 1.6; color: ${MUTED};">
        Your inbox, as one long conversation. No threads to untangle, no subject
        lines, no signatures — just the people you talk to.
      </p>
    </td></tr>
    <tr><td style="padding: 0 0 24px;">
      <a href="${appUrl}/app"
         style="display: inline-block; background: ${CORAL}; color: #ffffff;
                font-weight: 800; font-size: 14px; text-decoration: none;
                padding: 12px 22px; border-radius: 100px;">
        Open Wompy
      </a>
    </td></tr>
    <tr><td>
      <p style="margin: 0; font-size: 13px; line-height: 1.6; color: ${MUTED};">
        If you signed up with Google, your Gmail is already connecting.
        Otherwise, connect it from the app to start syncing.
      </p>
    </td></tr>
  `);

  return sendTransactionalEmail({
    to,
    subject: "Welcome to Wompy",
    text,
    html,
  });
}

/**
 * Wrap body rows in the shared email shell — centered card on a cream page,
 * with the wompy wordmark and a footer. Table-based for client compatibility.
 */
function wrapEmail(bodyRows: string): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin: 0; padding: 0; background: ${CREAM};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background: ${CREAM}; padding: 32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0"
             style="max-width: 480px; width: 100%;">
        <tr><td style="padding: 0 0 20px;">
          <span style="font-size: 20px; font-weight: 700; letter-spacing: -0.5px; color: ${SPRUCE};">
            wompy
          </span>
        </td></tr>
        <tr><td style="background: #ffffff; border-radius: 16px; padding: 28px;
                        box-shadow: 0 2px 12px rgba(0,0,0,0.05);">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${bodyRows}
          </table>
        </td></tr>
        <tr><td style="padding: 18px 4px 0;">
          <p style="margin: 0; font-size: 12px; color: ${MUTED};">
            You're receiving this because you signed up for Wompy.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
