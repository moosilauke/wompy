import { signOut } from "../actions";
import { SyncPoller } from "./SyncPoller";

/** Nav tabs from the design spec. Inert until the classifier lands — the
 * Contact/Company split is what makes them meaningful. */
const TABS = ["All", "Personal", "Work", "Promotions"] as const;

/**
 * Top bar: 64px, spruce background, mint logo mark + wordmark, nav tabs, and the
 * account control on the right (the authenticated counterpart to the marketing
 * version's Log in / Sign up).
 */
export function TopBar({ userEmail }: { userEmail: string | null }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-6 bg-spruce px-5 text-white">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="inline-block h-8 w-8 rounded-[10px] bg-mint"
        />
        <span className="font-display text-[21px] font-bold tracking-[-0.5px] lowercase">
          wompy
        </span>
      </div>

      <nav className="ml-2 hidden items-center gap-1 sm:flex">
        {TABS.map((tab, i) => (
          <span
            key={tab}
            aria-disabled
            title="Filtering arrives with the Contact/Company classifier"
            className={
              i === 0
                ? "rounded-full bg-mint/25 px-3 py-1.5 text-sm font-bold text-mint"
                : "cursor-default rounded-full px-3 py-1.5 text-sm font-semibold text-white/55"
            }
          >
            {tab}
          </span>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <SyncPoller />
        {userEmail && (
          <span className="hidden text-sm text-white/70 md:inline">
            {userEmail}
          </span>
        )}
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-full border border-white/25 px-4 py-1.5 text-sm font-bold text-white/90 transition-colors hover:bg-white/10"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
