"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "../actions";
import { initialsFor } from "@/lib/email/addresses";
import { lastSyncedLabel } from "@/lib/format";

/**
 * Account menu in the top-right.
 *
 * Collects everything that acts on the session or the account rather than on
 * mail: syncing, profile, settings, admin, sign out. Previously these sat loose
 * in the bar, which meant Sign Out occupied the coral primary-action slot —
 * prominence exactly inverted from how often anyone wants it.
 *
 * Rendered on every page via PageShell (settings, admin, etc.), not just the
 * mail view, so items tied to mail-view-only state (Sync now) render
 * conditionally rather than assuming that state exists.
 */

export interface AccountMenuItem {
  id: string;
  label: string;
  /** Present when the item navigates somewhere. */
  href?: string;
  /** Present when the item performs an action in place. */
  onSelect?: () => void;
  /** Rendered greyed out with a "Soon" tag. */
  comingSoon?: boolean;
  /** Separates groups; rendered above this item. */
  startsGroup?: boolean;
  /** Native hover tooltip (title attribute). */
  title?: string;
}

export function AccountMenu({
  userEmail,
  isAdmin,
  lastSyncedAt = null,
  onSync,
  syncing = false,
}: {
  userEmail: string | null;
  isAdmin: boolean;
  lastSyncedAt?: string | null;
  /** Omit on pages with no live SyncPoller (anything outside /app) — the Sync
   * now item only renders when this is provided, rather than being a dead
   * click or standing in for state that doesn't exist there. */
  onSync?: () => void;
  syncing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    firstItemRef.current?.focus();

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: AccountMenuItem[] = [
    // Only on pages with a live poller to run (see the prop comment above).
    ...(onSync
      ? [
          {
            id: "sync",
            label: syncing ? "Syncing…" : "Sync now",
            title: lastSyncedLabel(lastSyncedAt),
            onSelect: () => {
              onSync();
              setOpen(false);
            },
          },
        ]
      : []),
    {
      id: "settings",
      label: "Settings",
      href: "/settings",
      startsGroup: Boolean(onSync),
    },
    // Admin appears ONLY for admins — a real link, not a "Soon" placeholder.
    // A non-admin sees no trace of it, so the panel's existence isn't hinted
    // at from here.
    ...(isAdmin
      ? [{ id: "admin", label: "Admin", href: "/admin" }]
      : []),
  ];

  const label = userEmail ?? "Account";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-white/[0.08]"
      >
        <span
          aria-hidden
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-spruce-raised text-[12px] font-extrabold text-on-spruce-bright"
        >
          {initialsFor(label)}
        </span>
        <span
          aria-hidden
          className="text-[9px] leading-none text-on-spruce-muted"
        >
          ▼
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 min-w-[220px] overflow-hidden rounded-[12px] border border-black/[0.06] bg-white py-1 shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
        >
          {userEmail && (
            <div className="border-b border-black/[0.06] px-3.5 pb-2 pt-2.5">
              <p className="truncate text-[13px] font-bold text-text-body">
                {userEmail}
              </p>
              <p className="text-[11.5px] text-text-muted-3">Signed in</p>
            </div>
          )}

          {items.map((item, i) => (
            <div key={item.id}>
              {item.startsGroup && (
                <div className="my-1 border-t border-black/[0.06]" />
              )}
              <MenuRow
                item={item}
                buttonRef={i === 0 ? firstItemRef : undefined}
              />
            </div>
          ))}

          <div className="my-1 border-t border-black/[0.06]" />
          <form action={signOut}>
            <button
              type="submit"
              role="menuitem"
              className="block w-full px-3.5 py-2 text-left text-[13.5px] font-bold text-text-body transition-colors hover:bg-black/[0.04]"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function MenuRow({
  item,
  buttonRef,
}: {
  item: AccountMenuItem;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const className =
    "flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13.5px] font-bold transition-colors";

  if (item.comingSoon) {
    return (
      <button
        type="button"
        role="menuitem"
        disabled
        className={`${className} cursor-not-allowed text-text-muted-3`}
      >
        {item.label}
        <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.4px] text-text-muted-3">
          Soon
        </span>
      </button>
    );
  }

  if (item.href) {
    return (
      <Link
        href={item.href}
        role="menuitem"
        className={`${className} text-text-body hover:bg-black/[0.04]`}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      role="menuitem"
      title={item.title}
      onClick={item.onSelect}
      className={`${className} text-text-body hover:bg-black/[0.04]`}
    >
      {item.label}
    </button>
  );
}
