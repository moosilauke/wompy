"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query from React.
 *
 * `useSyncExternalStore` rather than `useEffect` + `useState` because the
 * server has no viewport. The third argument is the server snapshot: React
 * uses it for SSR and for the first client render, then re-renders with the
 * real value on commit. Reading `window.matchMedia` during render instead
 * would hydration-mismatch on every load that disagreed with the server.
 *
 * `serverValue` is explicit rather than defaulted because "which side should
 * the server guess?" depends on what the caller renders for each answer —
 * guess the branch that degrades better if it's briefly wrong.
 */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Tailwind's `md` breakpoint (48rem/768px), as a JS-side query. Kept here so
 * the value isn't duplicated at each call site and can't drift from the
 * `md:` classes it has to agree with. */
export const MD_BREAKPOINT = "(min-width: 48rem)";
