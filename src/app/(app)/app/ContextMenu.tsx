"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Generic right-click menu.
 *
 * Built as a reusable primitive rather than a one-off for Delete: actions are
 * passed in as data, so adding archive / mark-read / snooze / reclassify later
 * means appending an item, not touching this component.
 *
 * Accessibility: also opens via keyboard (the browser's context-menu key fires
 * the same event), closes on Escape / outside click / scroll, and moves focus
 * into the menu so it can be driven without a mouse.
 */

export interface MenuAction {
  id: string;
  label: string;
  /** Renders in coral to signal a destructive action. */
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface Position {
  x: number;
  y: number;
}

export function useContextMenu() {
  const [position, setPosition] = useState<Position | null>(null);

  const open = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPosition({ x: e.clientX, y: e.clientY });
  }, []);

  const close = useCallback(() => setPosition(null), []);

  return { position, open, close };
}

export function ContextMenu({
  position,
  actions,
  onClose,
}: {
  position: Position | null;
  actions: MenuAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Keep the menu on screen when opened near an edge. Done by mutating style in
  // a layout effect rather than via state: measuring then re-rendering would
  // cause a visible jump and a cascading render.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!position || !el) return;

    const rect = el.getBoundingClientRect();
    const x = Math.min(position.x, window.innerWidth - rect.width - 8);
    const y = Math.min(position.y, window.innerHeight - rect.height - 8);
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, y)}px`;
  }, [position]);

  useEffect(() => {
    if (!position) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    // Scrolling underneath would leave the menu stranded.
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [position, onClose]);

  // Move focus into the menu so keyboard users land in it.
  useEffect(() => {
    if (position && ref.current) {
      const firstItem = ref.current.querySelector("button:not([disabled])");
      (firstItem as HTMLButtonElement | null)?.focus();
    }
  }, [position]);

  if (!position) return null;

  return (
    <div
      ref={ref}
      role="menu"
      style={{ top: position.y, left: position.x }}
      className="fixed z-50 min-w-[190px] overflow-hidden rounded-[12px] border border-black/[0.06] bg-white py-1 shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
    >
      {actions.map((action) => (
        <button
          key={action.id}
          role="menuitem"
          type="button"
          disabled={action.disabled}
          onClick={() => {
            onClose();
            action.onSelect();
          }}
          className={`block w-full px-3.5 py-2 text-left text-[13.5px] font-bold transition-colors disabled:opacity-40 ${
            action.destructive
              ? "text-coral hover:bg-coral/10"
              : "text-text-body hover:bg-black/[0.04]"
          }`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
