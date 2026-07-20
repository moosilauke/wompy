import type { EmailProvider } from "@/lib/types";

/**
 * Registry of email providers Wompy can connect. Gmail is implemented; others
 * are declared here (and in the DB enum) as placeholders so the provider-generic
 * plumbing exists before their sync is built. `implemented: false` providers show
 * in the UI as disabled "coming soon" affordances.
 */
export interface ProviderInfo {
  id: EmailProvider;
  label: string;
  /** OAuth scopes requested when connecting this provider's inbox. */
  scopes: string[];
  implemented: boolean;
}

/** Gmail read + label scope. Reply/label features need write, so requested up front. */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

export const PROVIDERS: Record<EmailProvider, ProviderInfo> = {
  gmail: {
    id: "gmail",
    label: "Gmail",
    scopes: GMAIL_SCOPES,
    implemented: true,
  },
  yahoo: {
    id: "yahoo",
    label: "Yahoo",
    scopes: [],
    implemented: false,
  },
};

export function getProvider(id: EmailProvider): ProviderInfo {
  return PROVIDERS[id];
}

export function listProviders(): ProviderInfo[] {
  return Object.values(PROVIDERS);
}
