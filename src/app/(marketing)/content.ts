/**
 * Landing page content.
 *
 * Copy is final per the design handoff ("colors, type, spacing, and copy are
 * final for this MVP pass"), so it lives as data rather than being scattered
 * through markup — easier to revise without touching layout.
 */

/** Placeholder conversations in the rail. Personality is the point: these read
 * as a real person's inbox, which is what makes the chat model legible at a
 * glance. */
export const DEMO_CONTACTS = [
  {
    name: "Wompy",
    address: "wompy",
    snippet: "Let's get you set up",
    time: "now",
    unread: true,
    active: true,
  },
  {
    name: "Mom",
    address: "mom@example.com",
    snippet: "Call me later? No rush sweetie",
    time: "2h",
    unread: false,
    active: false,
  },
  {
    name: "Dude McDuderson",
    address: "dude@example.com",
    snippet: "yo it's been way too long brah",
    time: "4h",
    unread: false,
    active: false,
  },
  {
    name: "Abe Lincoln",
    address: "abe@example.com",
    snippet: "Four score and seven emails ago…",
    time: "9h",
    unread: false,
    active: false,
  },
  {
    name: "Erling Haaland",
    address: "leo@example.com",
    snippet: "See you at practice ⚽",
    time: "1d",
    unread: false,
    active: false,
  },
  {
    name: "Grandma Lou",
    address: "lou@example.com",
    snippet: "Sending pictures from the trip!",
    time: "2d",
    unread: false,
    active: false,
  },
  {
    name: "Landlord",
    address: "landlord@example.com",
    snippet: "Rent reminder for the 1st",
    time: "3d",
    unread: false,
    active: false,
  },
] as const;

/** The three feature bubbles, each with a coloured icon chip. */
export const FEATURES = [
  {
    title: "One chat per person or group",
    body: "No threads to untangle and everything from someone lives in one place.",
    chip: "bg-avatar-blue",
  },
  {
    title: "Feels like texting",
    body: "Familiar bubbles and quick replies, not a corporate inbox.",
    chip: "bg-avatar-sage",
  },
  {
    title: "Cuts the bloat",
    body: "No subject lines, no signatures, no AI slop. Just write what you mean.",
    chip: "bg-avatar-terracotta",
  },
] as const;

export const PLANS = [
  { label: "Free — $0/mo", popular: false },
  { label: "Plus — $6/mo", popular: true },
  { label: "Family — $12/mo", popular: false },
] as const;

/**
 * Utility links in the rail's collapsible "More" section. Most render inert
 * (no page yet); only ones with an `href` are live, so nothing 404s.
 */
export const MORE_LINKS: { label: string; href?: string }[] = [
  { label: "About us" },
  { label: "Documentation" },
  { label: "Privacy policy", href: "/privacy" },
  { label: "FAQs" },
  { label: "Get help" },
];
