"use client";

import { useEffect, useRef, useState } from "react";
import type { AppView } from "@/lib/types";

/**
 * The "More" dropdown in the top bar.
 *
 * Contacts and Companies are the daily views and stay as first-class tabs.
 * Sent, Trash, and Spam are the places you go deliberately when looking for
 * something specific, so they collapse behind one control rather than each
 * spending a permanent slot in the nav.
 *
 * The trigger shows the active view's name when one is selected, so the current
 * location is never hidden inside a closed menu.
 */

export interface MoreItem {
  id: AppView;
  label: string;
  count: number;
}

export function MoreMenu({
  items,
  activeView,
  onSelect,
}: {
  items: MoreItem[];
  activeView: AppView;
  onSelect: (view: AppView) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  const active = items.find((i) => i.id === activeView);

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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-1.5 rounded-[10px] px-[13px] py-[7px] text-[13px] font-bold transition-colors ${
          active
            ? "bg-[oklch(0.8_0.13_175_/_0.25)] text-white"
            : "text-on-spruce-muted hover:text-white"
        }`}
      >
        {active ? active.label : "More"}
        {active && (
          <span className="font-semibold opacity-70">{active.count}</span>
        )}
        <span aria-hidden className="text-[9px] leading-none opacity-70">
          ▼
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[170px] overflow-hidden rounded-[12px] border border-black/[0.06] bg-white py-1 shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
        >
          {items.map((item, i) => (
            <button
              key={item.id}
              ref={i === 0 ? firstItemRef : undefined}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect(item.id);
              }}
              className={`flex w-full items-center justify-between gap-4 px-3.5 py-2 text-left text-[13.5px] font-bold transition-colors hover:bg-black/[0.04] ${
                item.id === activeView ? "text-coral" : "text-text-body"
              }`}
            >
              <span>{item.label}</span>
              <span className="text-[12px] font-semibold text-text-muted-3">
                {item.count}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
