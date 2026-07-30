"use client";

import { useCallback, useState } from "react";

/**
 * Ctrl/Cmd-click and Shift-click multi-select over a rail's thread list,
 * classic file-manager semantics:
 *  - Plain click: handled by the caller (navigation). Also clears any active
 *    selection here — opening a new thread with no modifier means "just this
 *    one," matching how most apps drop a multi-selection on a plain click.
 *  - Ctrl/Cmd-click: toggle one row in/out of the selection.
 *  - Shift-click: select the contiguous range between the last "anchor" row
 *    and the clicked row (replacing, not adding to, any prior range — matches
 *    Finder/Gmail rather than accumulating disjoint ranges).
 *
 * The currently OPEN thread is always the implicit starting anchor: with
 * nothing explicitly selected yet, ctrl-clicking a second row selects BOTH
 * the open thread and that row (not just the one clicked) — you're already
 * looking at the first one, so a bulk action naturally should include it —
 * and a shift-click with no prior ctrl-click extends the range from the open
 * thread rather than collapsing to a single row (the bug this replaces: with
 * no anchor yet, `from ?? threadId` fell back to the clicked row itself,
 * making the very first shift-click a no-op range of one).
 *
 * Selection is per-tab (one instance of this hook per ContactTab) rather than
 * one global set, since ctrl/shift-click only ever makes sense within the one
 * list the user is looking at — switching tabs shows a different thread list
 * entirely, so a carried-over selection would silently apply to threads no
 * longer visible.
 */
export function useThreadSelection(
  threadIds: string[],
  openThreadId: string | null,
) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);

  const clear = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  /**
   * Called from a row's onClick. Returns true if the click was consumed as a
   * selection toggle (ctrl/shift held) — the caller should suppress its
   * normal navigation in that case, since a modifier-click means "select,"
   * not "open."
   */
  const handleClick = useCallback(
    (threadId: string, e: React.MouseEvent): boolean => {
      if (e.shiftKey) {
        e.preventDefault();
        const from = anchor ?? openThreadId ?? threadId;
        const fromIdx = threadIds.indexOf(from);
        const toIdx = threadIds.indexOf(threadId);
        if (fromIdx === -1 || toIdx === -1) return true;
        const [start, end] =
          fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        setSelected(new Set(threadIds.slice(start, end + 1)));
        // Shift-click doesn't move the anchor — repeated shift-clicks extend
        // or shrink relative to the SAME anchor, matching Finder/Gmail rather
        // than re-anchoring on every click.
        return true;
      }

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setSelected((prev) => {
          const next = new Set(prev);
          // Nothing explicitly selected yet: seed with the open thread too,
          // so "viewing A, ctrl-click B" selects both, not just B.
          if (next.size === 0 && openThreadId && openThreadId !== threadId) {
            next.add(openThreadId);
          }
          if (next.has(threadId)) next.delete(threadId);
          else next.add(threadId);
          return next;
        });
        setAnchor((prev) => prev ?? openThreadId ?? threadId);
        return true;
      }

      // Plain click: opening a new thread with no modifier means "just this
      // one" — drop any active multi-selection rather than leaving it
      // stranded alongside a newly-opened, unrelated thread.
      if (selected.size > 0) clear();
      return false;
    },
    [anchor, threadIds, openThreadId, selected, clear],
  );

  return { selected, handleClick, clear };
}
