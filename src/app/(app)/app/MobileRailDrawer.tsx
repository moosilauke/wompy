"use client";

import { useEffect, useRef, useState } from "react";

const OPEN_THRESHOLD = 0.4; // fraction of the drawer's width to snap open past
const EDGE_SWIPE_ZONE = 24; // px from the left edge that starts a drag

/**
 * Mobile presentation of the contact rail: a swipeable overlay drawer rather
 * than a permanent sidebar, so the reading pane can be the default mobile
 * view. Desktop is unaffected — `AppShell` only renders this below `md`, and
 * renders `ContactRail` inline (no drawer chrome) at `md` and up.
 *
 * A small edge handle is always visible as the "you can pull this out"
 * affordance; both it and a thin edge-swipe zone start a drag that tracks the
 * pointer 1:1 via `translateX`, snapping open or shut on release based on
 * how far past the drawer's width the drag went. No gesture library is in
 * the project, so this is hand-rolled with pointer events (unifies touch and
 * mouse, unlike separate touch handlers).
 */
export function MobileRailDrawer({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);
  // Measured via ResizeObserver rather than read from the ref during render —
  // reading `.offsetWidth` off a ref in render is unsafe (it can read a stale
  // DOM node before commit), so the width lives in state instead.
  const [panelWidth, setPanelWidth] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef(0);
  const dragStartWasOpen = useRef(false);

  const close = () => setOpen(false);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setPanelWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Escape-to-close and body-scroll-freeze while open — same shape as Modal.tsx.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Drag tracking lives on `window` rather than JSX handlers so it keeps
  // following the pointer even once it leaves the handle/edge-zone element.
  useEffect(() => {
    if (dragX === null) return;

    const width = panelWidth || 1;

    const onPointerMove = (e: PointerEvent) => {
      const delta = e.clientX - dragStartX.current;
      const base = dragStartWasOpen.current ? width : 0;
      const next = Math.min(width, Math.max(0, base + delta));
      setDragX(next);
    };

    const onPointerUp = () => {
      setDragX((current) => {
        const fraction = (current ?? 0) / width;
        setOpen(fraction >= OPEN_THRESHOLD);
        return null;
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragX !== null, panelWidth]);

  const startDrag = (e: React.PointerEvent) => {
    dragStartX.current = e.clientX;
    dragStartWasOpen.current = open;
    setDragX(open ? panelWidth : 0);
  };

  const dragging = dragX !== null;
  const translate = dragging
    ? `translateX(${dragX! - panelWidth}px)`
    : open
      ? "translateX(0)"
      : "translateX(-100%)";

  return (
    <>
      {/* Persistent affordance: always visible at rest, hints the drawer can
          be pulled out. Also a tap target to open it outright. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        onPointerDown={startDrag}
        aria-label="Open conversations"
        aria-expanded={open}
        className={`fixed left-0 top-1/2 z-40 flex h-14 w-6 -translate-y-1/2 items-center justify-center rounded-r-[10px] bg-spruce text-on-spruce-muted shadow-[2px_0_10px_rgba(0,0,0,0.2)] transition-opacity md:hidden ${
          open ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <span aria-hidden className="text-[11px]">›</span>
      </button>

      {/* Thin invisible edge-swipe zone, active only while closed. */}
      {!open && (
        <div
          onPointerDown={startDrag}
          style={{ width: EDGE_SWIPE_ZONE }}
          className="fixed inset-y-0 left-0 z-30 md:hidden"
        />
      )}

      {/* Backdrop: dims and dismisses, mirrors Modal.tsx. */}
      <div
        onClick={close}
        role="presentation"
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${
          open || dragging
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        style={
          dragging ? { opacity: (dragX ?? 0) / (panelWidth || 1) } : undefined
        }
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Conversations"
        // Closing on navigation: every row in ContactRail is a <Link>, so a
        // capturing click handler here catches the click before Next.js's
        // router does, without ContactRail needing to know about the drawer.
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest("a")) close();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={`fixed inset-y-0 left-0 z-50 w-[85%] max-w-[340px] md:hidden ${
          dragging ? "" : "transition-transform duration-200 ease-out"
        }`}
        style={{ transform: translate }}
      >
        {/* Drag handle strip along the drawer's own trailing edge, so an
            already-open drawer can be dragged shut too. */}
        <div
          onPointerDown={startDrag}
          className="absolute inset-y-0 -right-3 z-10 w-6"
        />
        {children}
      </div>
    </>
  );
}
