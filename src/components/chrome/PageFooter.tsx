import { BrandMark } from "@/components/ui/BrandMark";

/**
 * Shared footer for non-mail pages. Spruce, matching the top bar — the
 * palette's dark tone is reserved for exactly these two chrome bands (see
 * globals.css), never introduced as a third surface color.
 *
 * Links point at routes that don't all exist yet; each renders as an inert
 * span rather than a Link until its page is built, so nothing 404s.
 */
const FOOTER_LINKS: { label: string; href: string }[] = [
  { label: "About", href: "/about" },
  { label: "Documentation", href: "/docs" },
  { label: "Privacy policy", href: "/privacy" },
  { label: "FAQs", href: "/faq" },
  { label: "Get help", href: "/help" },
];

export function PageFooter() {
  return (
    <footer className="shrink-0 border-t border-spruce-edge bg-spruce px-7 py-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <BrandMark size={22} />

        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          {FOOTER_LINKS.map((link) => (
            <span
              key={link.href}
              className="cursor-default text-[13px] font-semibold text-on-spruce-muted"
            >
              {link.label}
            </span>
          ))}
        </nav>

        <p className="text-[12px] text-on-spruce-muted">
          © {new Date().getFullYear()} Wompy
        </p>
      </div>
    </footer>
  );
}
