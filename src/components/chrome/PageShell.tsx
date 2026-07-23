import Link from "next/link";
import { BrandMark } from "@/components/ui/BrandMark";
import { AccountMenu } from "@/app/(app)/app/AccountMenu";
import { PageFooter } from "./PageFooter";

/**
 * Shared chrome for every non-mail page: static content (about, docs, privacy)
 * and in-app-but-not-mail pages (Settings, Admin) alike.
 *
 * The mail view (`/app`) has its own shell — a rail, tabs, live sync — none of
 * which apply here, so this is a second, lighter shell rather than a mode of
 * AppShell. What it DOES share with the mail view is the same spruce top bar
 * (brand mark, account menu) so navigating between "the app" and "a settings
 * page" reads as one product, not a page transition into different software.
 * "Sync now" doesn't appear here — see AccountMenu — since there's no live
 * SyncPoller running outside the mail view.
 *
 * `back` renders a "← Back to app" link where the mail view's tabs would be;
 * pages with nowhere obvious to return to (a public, unauthenticated page) can
 * omit it.
 */
export function PageShell({
  userEmail,
  isAdmin,
  back,
  children,
}: {
  userEmail: string | null;
  isAdmin: boolean;
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-spruce-edge bg-spruce px-7 shadow-[0_2px_12px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-7">
          <Link href="/app" aria-label="Wompy">
            <BrandMark />
          </Link>
          {back && (
            <Link
              href={back.href}
              className="text-[13px] font-bold text-on-spruce-muted transition-colors hover:text-white"
            >
              ← {back.label}
            </Link>
          )}
        </div>

        {userEmail && <AccountMenu userEmail={userEmail} isAdmin={isAdmin} />}
      </header>

      <main className="flex-1 bg-cream">{children}</main>

      <PageFooter />
    </div>
  );
}
