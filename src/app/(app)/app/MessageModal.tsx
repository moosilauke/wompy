"use client";

import { useEffect, useRef } from "react";

/**
 * Full-message view.
 *
 * Bubbles show a trimmed excerpt; this is where the whole thing lives. Shown as
 * a modal rather than inline expansion so a long message can't push the rest of
 * the conversation off screen — the chat view's shape is the point.
 *
 * `body_html` is still never injected: this renders the plain-text body.
 */
export function MessageModal({
  open,
  onClose,
  title,
  subtitle,
  body,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | null;
  body: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    // Focus the close button so Escape and Tab are immediately available.
    closeRef.current?.focus();

    // Prevent the conversation behind the modal from scrolling.
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
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Stop clicks inside the panel from reaching the backdrop's close handler.
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_24px_60px_rgba(0,0,0,0.28)]"
      >
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
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full px-3 py-1 text-[13px] font-bold text-text-muted transition-colors hover:bg-black/[0.05] hover:text-text-body"
          >
            Close
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          <p className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.6] text-text-body">
            {body}
          </p>
        </div>
      </div>
    </div>
  );
}
