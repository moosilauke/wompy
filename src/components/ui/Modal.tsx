"use client";

import { useEffect, useRef } from "react";

/**
 * Modal shell: backdrop, panel, and the behaviour every dialog needs — Escape
 * to close, click-outside to close, focus moved inside, and the page behind
 * frozen so it doesn't scroll under the overlay.
 *
 * Extracted from the message viewer so the auth dialog doesn't reimplement it.
 * Callers supply their own header and body; only the chrome and the keyboard /
 * pointer handling live here.
 */
export function Modal({
  open,
  onClose,
  label,
  maxWidth = 680,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  maxWidth?: number;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    // Move focus into the dialog so Escape and Tab act on it immediately.
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      "input:not([disabled]), button:not([disabled]), [href], select, textarea",
    );
    focusable?.focus();

    // Freeze the page behind the overlay.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // Stop clicks inside the panel from reaching the backdrop's handler.
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth }}
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_24px_60px_rgba(0,0,0,0.28)]"
      >
        {children}
      </div>
    </div>
  );
}

/** Standard modal header: title, optional subtitle, and a Close button. */
export function ModalHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string | null;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-6 py-4">
      <div className="min-w-0">
        <h2 className="truncate font-display text-[16px] font-bold text-text-body">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 truncate text-[13px] text-text-muted">
            {subtitle}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="shrink-0 rounded-full px-3 py-1 text-[13px] font-bold text-text-muted transition-colors hover:bg-black/[0.05] hover:text-text-body"
      >
        Close
      </button>
    </div>
  );
}
