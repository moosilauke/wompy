import { registrableDomain } from "@/lib/email/addresses";

/**
 * Company logos via Brandfetch's Logo Link.
 *
 * Brandfetch serves logos as direct CDN image URLs
 * (cdn.brandfetch.io/{domain}?c={clientId}) and REQUIRES them to be embedded in
 * the client rather than fetched and cached server-side. That's the opposite of
 * how tracking-sensitive lookups are normally handled here — but it's fine for
 * this case: the browser requests the SENDER's public brand logo by domain
 * (amazon.com), which reveals nothing private about the user. Brandfetch learns
 * "an IP requested the Amazon logo", not which email was opened or when.
 *
 * Logos are only ever shown for organizations, never people and never spam
 * (decided at the call site), and only when the domain confidently maps to a
 * brand — an email-service-provider domain would show the ESP's logo on the
 * brand's row, which is worse than initials, so those are skipped here.
 *
 * Pure and dependency-free apart from registrableDomain.
 */

/**
 * Domains that send on behalf of other brands. A logo for one of these would be
 * the ESP's, not the sender's — feefo.com rendering the Feefo logo on a Charles
 * Tyrwhitt row. Skipped so those fall back to initials.
 *
 * Not exhaustive; it covers the ESPs seen in the corpus plus the common ones.
 * A missed ESP shows a wrong logo (rare, recoverable), never a crash.
 */
const EMAIL_SERVICE_PROVIDERS = new Set([
  "feefo.com",
  "sendgrid.net",
  "sendgrid.com",
  "mailchimp.com",
  "mcsv.net",
  "mandrillapp.com",
  "sparkpostmail.com",
  "mailgun.org",
  "mailgun.net",
  "amazonses.com",
  "sendinblue.com",
  "sib.email",
  "constantcontact.com",
  "rsgsv.net",
  "cmail19.com",
  "cmail20.com",
  "createsend.com",
  "klaviyomail.com",
  "hubspotemail.net",
  "exacttarget.com",
  "mktomail.com",
  "salesforce.com",
  "icontact.com",
  "postmarkapp.com",
  "custalert.com",
  "e.customeriomail.com",
]);

/** Whether a sender domain should get a Brandfetch logo at all. */
export function logoDomainFor(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at === -1) return null;

  const registrable = registrableDomain(address.slice(at + 1));
  if (!registrable) return null;
  if (EMAIL_SERVICE_PROVIDERS.has(registrable)) return null;

  return registrable;
}

/**
 * The Brandfetch Logo Link for a domain, or null when no client id is
 * configured (so the app degrades cleanly to initials).
 *
 * `type=icon` (the square brand icon) rather than `type=logo` (a wide
 * wordmark): an icon is designed to fill a tile, so it sits cleanly in a
 * circular avatar, where a wordmark would be letterboxed or cropped hard.
 *
 * Requested at 128px though it renders at ~44px, so it stays crisp on 2x/3x
 * retina displays instead of being upscaled and blurry.
 *
 * `fallback=404` makes Brandfetch return a real 404 for an unknown brand instead
 * of a generic lettermark, so the <img> can onError back to our own
 * colored-initials avatar rather than a Brandfetch placeholder we don't control.
 */
export function brandLogoUrl(domain: string): string | null {
  const clientId = process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID;
  if (!clientId) return null;

  const params = new URLSearchParams({
    c: clientId,
    type: "icon",
    fallback: "404",
  });
  return `https://cdn.brandfetch.io/${domain}/w/128/h/128?${params.toString()}`;
}
