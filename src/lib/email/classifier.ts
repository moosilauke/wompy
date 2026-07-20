import type { ContactTab } from "@/lib/types";

/**
 * Contact vs. Company classifier (MVP build step 2).
 *
 * Deterministic rules only — no ML, no AI, per the project's brand stance. Pure
 * and side-effect free so it can be run against real synced data and tested
 * directly.
 *
 * Rules, in priority order (from wompy-mvp-plan.md, plus rule 0):
 *   0. Gmail labeled it SPAM                             -> Spam
 *   1. List-Unsubscribe or Precedence: bulk/list header  -> Company
 *   2. You have ever replied to this sender              -> Contact (OVERRIDES 0, 1)
 *   6. Address is no-reply@ / donotreply@                -> Company
 *   3. No bulk header + free-mail domain                 -> Contact
 *   5. No bulk header + mail-client Message-ID           -> Contact
 *   4. Everything else                                   -> Company (safe default)
 *
 * (Rules are numbered in the order they were added, not the order they run.)
 *
 * Rule 5 covers the case rules 1-4 collectively miss: a real person writing from
 * a corporate domain, before you have replied to them. A recruiter or colleague
 * at their own company would otherwise sit in Companies until you happened to
 * reply. It runs last among the promoting rules so bulk and spam signals always
 * take precedence.
 *
 * Rule 6 exists because Rule 5's evidence can be forged by accident: bulk
 * senders sometimes emit Message-IDs that look hand-composed. An address saying
 * "no-reply" is the sender declaring outright that this is not correspondence,
 * which is stronger evidence than anything inferred from message construction —
 * so it is checked before both Contact-promoting rules.
 *
 * Rule 0 uses Gmail's own spam verdict rather than our own heuristics — it's a
 * provider signal, and reimplementing spam detection is out of scope. Spam is
 * quarantined to its own tab, never deleted, because the verdict has false
 * positives. Rule 2 still wins: if you have actually corresponded with someone,
 * they are a Contact even if Gmail flagged them.
 *
 * Rule 2 is the important one: it rescues the solo contractor using a Gmail
 * address for business, or any sender whose mail looks bulk but who you're in a
 * genuine back-and-forth with.
 *
 * Uncertain senders bias toward Company on purpose — a stranger cluttering the
 * low-stakes list view costs far less than one intruding on the intimate chat view.
 */

/** Free/consumer mail domains: a personal address here suggests a real person. */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "mail.com",
  "yandex.com",
]);

/** Headers that mark mail as bulk/list traffic. */
const BULK_PRECEDENCE_VALUES = new Set(["bulk", "list", "junk"]);

/**
 * Message-ID suffixes that identify mail composed in a human mail client.
 *
 * Mail clients stamp their own Message-ID domain; bulk senders and ESPs use
 * their sending infrastructure's. That makes this a strong "a person typed
 * this" signal — and unlike display names or subjects, it's not something
 * marketing mail imitates, because it's a byproduct of how the mail was sent.
 *
 * Deliberately narrow: only suffixes we're confident belong to interactive
 * clients. An unrecognized client means the sender falls through to the Company
 * default, which is the intended bias for uncertain senders.
 */
const MAIL_CLIENT_MESSAGE_ID_SUFFIXES = [
  "@mail.gmail.com", // Gmail web and mobile
  "@mail.yahoo.com",
  "@me.com", // Apple Mail / iCloud
  "@icloud.com",
];

/**
 * Message-ID patterns for interactive clients that don't use a fixed domain.
 * Outlook and Thunderbird key off the local part's shape instead.
 */
const MAIL_CLIENT_MESSAGE_ID_PATTERNS = [
  // Exchange / Outlook mailbox ids, e.g. <...MB1234...@namprd01.prod.outlook.com>
  // Anchored to the sending domain, not just the local-part shape.
  /^<[a-z0-9]{2,}mb\d+[a-z0-9]*@[a-z0-9.-]*(outlook|exchangelabs|prod)\b/i,
];

/**
 * Address local-parts that declare no human is reading replies. A sender saying
 * "do not reply" is stating outright that this is not correspondence, which
 * outranks any inference drawn from how the mail was constructed.
 */
const NO_REPLY_PATTERN = /(^|[._-])(no-?reply|do-?not-?reply|donotreply|noreply)([._-]|$)/i;

/** True when the address advertises itself as unattended. */
export function isNoReplyAddress(address: string): boolean {
  const at = address.lastIndexOf("@");
  const local = at === -1 ? address : address.slice(0, at);
  return NO_REPLY_PATTERN.test(local);
}

/**
 * True when a Message-ID looks like it came from a human mail client rather
 * than bulk-sending infrastructure.
 */
export function isMailClientMessageId(messageId: string | undefined): boolean {
  if (!messageId) return false;
  const value = messageId.trim().toLowerCase();
  if (!value) return false;

  if (MAIL_CLIENT_MESSAGE_ID_SUFFIXES.some((s) => value.endsWith(`${s}>`))) {
    return true;
  }
  return MAIL_CLIENT_MESSAGE_ID_PATTERNS.some((p) => p.test(value));
}

export interface ClassifierInput {
  /** Bare, lowercased sender address. */
  address: string;
  /** Merged headers seen from this sender (lowercased keys). */
  headers: Record<string, string>;
  /** True when the user has ever sent mail to this address. */
  hasReplied: boolean;
  /** True when Gmail labeled any message from this sender as SPAM. */
  markedSpam?: boolean;
  /**
   * True when any message from this sender carried a Message-ID belonging to a
   * human mail client. Computed per-message at ingest, then OR'd per sender.
   */
  usesMailClient?: boolean;
}

export interface ClassificationSignals {
  /** Which numbered rule decided the outcome. */
  rule: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Short human-readable justification, surfaced in the debug view. */
  reason: string;
  hasListUnsubscribe: boolean;
  precedence: string | null;
  isFreeMailDomain: boolean;
  hasReplied: boolean;
  markedSpam: boolean;
  usesMailClient: boolean;
  /** True when the address advertises itself as unattended (no-reply@…). */
  isNoReply: boolean;
  domain: string | null;
}

export interface Classification {
  tab: ContactTab;
  signals: ClassificationSignals;
}

/** Domain part of an address, or null if it isn't parseable. */
export function domainOf(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at === -1 || at === address.length - 1) return null;
  return address.slice(at + 1).toLowerCase();
}

export function isFreeMailDomain(address: string): boolean {
  const domain = domainOf(address);
  return domain ? FREE_MAIL_DOMAINS.has(domain) : false;
}

/**
 * Classify a single sender. Callers persist `tab` and `signals`; the signals are
 * kept for debugging and auditing why a sender landed where it did.
 */
export function classifySender(input: ClassifierInput): Classification {
  const {
    address,
    headers,
    hasReplied,
    markedSpam = false,
    usesMailClient = false,
  } = input;

  const hasListUnsubscribe = Boolean(headers["list-unsubscribe"]);
  const precedenceRaw = headers["precedence"]?.trim().toLowerCase() ?? null;
  const isBulkPrecedence = precedenceRaw
    ? BULK_PRECEDENCE_VALUES.has(precedenceRaw)
    : false;
  const freeMail = isFreeMailDomain(address);
  const domain = domainOf(address);
  const noReply = isNoReplyAddress(address);

  const base = {
    hasListUnsubscribe,
    precedence: precedenceRaw,
    isFreeMailDomain: freeMail,
    hasReplied,
    markedSpam,
    usesMailClient,
    isNoReply: noReply,
    domain,
  };

  // Rule 2 first in evaluation order because it overrides rules 0 and 1: actual
  // correspondence beats both a bulk header and Gmail's spam verdict.
  if (hasReplied) {
    return {
      tab: "contact",
      signals: {
        ...base,
        rule: 2,
        reason: "You have replied to this sender, so they are a Contact.",
      },
    };
  }

  // Rule 0: trust Gmail's spam verdict. Quarantined, never deleted.
  if (markedSpam) {
    return {
      tab: "spam",
      signals: {
        ...base,
        rule: 0,
        reason: "Gmail marked mail from this sender as spam.",
      },
    };
  }

  // Rule 1: bulk/list headers are a near-certain Company signal.
  if (hasListUnsubscribe || isBulkPrecedence) {
    const which = [
      hasListUnsubscribe ? "List-Unsubscribe" : null,
      isBulkPrecedence ? `Precedence: ${precedenceRaw}` : null,
    ]
      .filter(Boolean)
      .join(" and ");
    return {
      tab: "company",
      signals: {
        ...base,
        rule: 1,
        reason: `Bulk mail header present (${which}).`,
      },
    };
  }

  // Rule 6: the address declares that nobody reads replies. This sits ahead of
  // both Contact-promoting rules because it is the sender stating outright that
  // this is not correspondence, which beats anything inferred from the domain or
  // from how the message was constructed. Rule 2 still wins: if you have
  // actually replied and got a response, the naming convention is beside the
  // point.
  if (noReply) {
    return {
      tab: "company",
      signals: {
        ...base,
        rule: 6,
        reason:
          "The sending address declares itself unattended (no-reply), so it is not correspondence.",
      },
    };
  }

  // Rule 3: no bulk header on a consumer domain suggests a real person.
  if (freeMail) {
    return {
      tab: "contact",
      signals: {
        ...base,
        rule: 3,
        reason: `No bulk headers and ${domain} is a free-mail domain.`,
      },
    };
  }

  // Rule 5: a person on a corporate domain. Reached only after the bulk and
  // spam rules have declined, so a marketing address with a human display name
  // (e.g. "Mark Levesque" <invitations@linkedin.com>) is already in Company and
  // never gets here.
  if (usesMailClient) {
    return {
      tab: "contact",
      signals: {
        ...base,
        rule: 5,
        reason:
          "Mail was composed in a personal mail client (Message-ID), not by bulk-sending infrastructure.",
      },
    };
  }

  // Rule 4: bias unknown senders toward Company.
  return {
    tab: "company",
    signals: {
      ...base,
      rule: 4,
      reason: domain
        ? `No bulk headers, but ${domain} is not free-mail and you have never replied.`
        : "Sender address could not be parsed; defaulting to Company.",
    },
  };
}

/**
 * Decide a thread's tab from its participants' classifications.
 *
 * Spam wins first: if any participant is spam, the whole thread is quarantined,
 * so a spammer can't escape by adding a fake extra recipient. (That is exactly
 * how spam reached the Contacts tab before — a forged To: address had no contact
 * row, was treated as unknown, and dragged the thread out of quarantine.)
 *
 * Otherwise a thread is a Contact conversation when any participant is a known
 * Contact. Unknown participants deliberately do NOT imply Contact — they fall
 * through to Company, matching the plan's bias for uncertain senders.
 */
export function tabForThread(participantTabs: ContactTab[]): ContactTab {
  if (participantTabs.some((t) => t === "spam")) return "spam";
  if (participantTabs.some((t) => t === "contact")) return "contact";
  return "company";
}
