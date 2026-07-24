"use client";

import Link from "next/link";
import { useState } from "react";

/** Utility links in the rail's collapsible "More" section. Shared by the
 * anonymous landing page and the logged-in mail view alike. */
const MORE_LINKS: { label: string; href: string }[] = [
  { label: "About Wompy", href: "/about" },
  { label: "Documentation", href: "/docs" },
  { label: "Privacy policy", href: "/privacy" },
  { label: "Get help", href: "/help" },
];

const STORAGE_KEY = "wompy:more-links-open";

/**
 * The rail's collapsible "More" section — built on <details>/<summary> for
 * its expand/collapse mechanics (native keyboard + a11y support, no extra
 * ARIA wiring), with a thin client layer only to persist the open/closed
 * state across visits.
 *
 * `defaultOpen` sets the first-ever impression for a given browser (open on
 * the landing page, where these links are the pitch; closed inside the
 * logged-in app, where the rail's job is mail, not marketing). Once a
 * visitor toggles it, their choice sticks via localStorage — deliberately
 * not a database-backed setting, since it's a per-device display
 * preference, not account state.
 *
 * The stored value is read lazily in the `useState` initializer rather than
 * an effect, so there's no render-then-snap flicker after mount. That does
 * mean the client's first render can legitimately disagree with the
 * server-rendered `defaultOpen` markup whenever a stored preference exists —
 * expected, not a bug, so hydration-mismatch warnings on `open` are
 * suppressed rather than "fixed" by reintroducing the flicker.
 */
export function MoreLinks({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return defaultOpen;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === null ? defaultOpen : stored === "1";
    } catch {
      return defaultOpen;
    }
  });

  return (
    <details
      className="group shrink-0 border-t border-spruce-edge px-2 py-2"
      open={open}
      suppressHydrationWarning
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        try {
          window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
        } catch {
          // Storage unavailable — the preference just won't persist.
        }
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-3 py-2 text-[13px] font-bold text-on-spruce-muted transition-colors hover:text-white">
        More
        <span
          aria-hidden
          className="text-[14px] transition-transform duration-150 group-open:rotate-180"
        >
          ⌄
        </span>
      </summary>

      <ul className="flex flex-col pb-1 pt-0.5">
        {MORE_LINKS.map((link) => (
          <li key={link.label}>
            <Link
              href={link.href}
              className="block px-3 py-1.5 text-[12.5px] font-semibold text-on-spruce-muted transition-colors hover:text-white"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
