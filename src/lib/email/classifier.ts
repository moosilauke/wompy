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
 *   3. No bulk header + free-mail domain                 -> Contact
 *   4. Everything else                                   -> Company (safe default)
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

export interface ClassifierInput {
  /** Bare, lowercased sender address. */
  address: string;
  /** Merged headers seen from this sender (lowercased keys). */
  headers: Record<string, string>;
  /** True when the user has ever sent mail to this address. */
  hasReplied: boolean;
  /** True when Gmail labeled any message from this sender as SPAM. */
  markedSpam?: boolean;
}

export interface ClassificationSignals {
  /** Which numbered rule decided the outcome. */
  rule: 0 | 1 | 2 | 3 | 4;
  /** Short human-readable justification, surfaced in the debug view. */
  reason: string;
  hasListUnsubscribe: boolean;
  precedence: string | null;
  isFreeMailDomain: boolean;
  hasReplied: boolean;
  markedSpam: boolean;
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
  const { address, headers, hasReplied, markedSpam = false } = input;

  const hasListUnsubscribe = Boolean(headers["list-unsubscribe"]);
  const precedenceRaw = headers["precedence"]?.trim().toLowerCase() ?? null;
  const isBulkPrecedence = precedenceRaw
    ? BULK_PRECEDENCE_VALUES.has(precedenceRaw)
    : false;
  const freeMail = isFreeMailDomain(address);
  const domain = domainOf(address);

  const base = {
    hasListUnsubscribe,
    precedence: precedenceRaw,
    isFreeMailDomain: freeMail,
    hasReplied,
    markedSpam,
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
