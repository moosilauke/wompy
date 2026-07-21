import type { Metadata } from "next";
import { LandingPage } from "./(marketing)/LandingPage";

/**
 * Root route — the marketing landing page, which doubles as a preview of the
 * app shell.
 *
 * Deliberately static. An earlier version checked the session here and
 * redirected signed-in users to /app, which meant every visitor waited on
 * Supabase before seeing anything. On the page whose job is converting people
 * who bounce in seconds, that trade is backwards: this is now prerendered at
 * build time and served without touching the database.
 *
 * Signed-in users reach the app from the header, and /app is one click away.
 * The proxy also skips its session refresh for this path.
 */
export const metadata: Metadata = {
  title: "Wompy — your inbox, as one long conversation",
  description:
    "Wompy turns every person and group into a single running chat — no threads to untangle, no subject lines to write, no signatures to remember.",
  openGraph: {
    title: "Wompy — your inbox, as one long conversation",
    description:
      "Email that reads like texting. One chat per person, no threads or subject lines.",
    type: "website",
  },
};

export default function Home() {
  return <LandingPage />;
}
