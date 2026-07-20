import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /*
     * Client Cache for dynamic pages.
     *
     * Next 15 changed the `dynamic` default to 0 seconds, so navigations to a
     * dynamic route (which /app is, via force-dynamic) always re-render on the
     * server. 20s means selecting a thread you just viewed, or going back, is
     * served from memory instead.
     *
     * Safe for mail because router.refresh() invalidates this cache, and the
     * sync poller calls it whenever new mail lands — so the window can never
     * hide messages that have actually arrived. Kept short so a manual reload
     * is never needed to see fresh state.
     *
     * Still flagged experimental upstream; revisit when it stabilizes.
     */
    staleTimes: {
      dynamic: 20,
      static: 180,
    },
  },
};

export default nextConfig;
