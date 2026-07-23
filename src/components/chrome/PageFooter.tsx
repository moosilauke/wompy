import Link from "next/link";
import { BrandMark } from "@/components/ui/BrandMark";

/**
 * Shared footer for non-mail pages. Spruce, matching the top bar — the
 * palette's dark tone is reserved for exactly these two chrome bands (see
 * globals.css), never introduced as a third surface color.
 *
 * Most links point at routes that don't exist yet, so they render as an inert
 * span rather than a Link until each page is built — only ones with `href` are
 * live, so nothing 404s.
 */
const FOOTER_LINKS: { label: string; href?: string }[] = [
  { label: "About" },
  { label: "Documentation" },
  { label: "Privacy policy", href: "/privacy" },
  { label: "FAQs" },
  { label: "Get help" },
];

export function PageFooter() {
  return (
    <footer className="shrink-0 border-t border-spruce-edge bg-spruce px-7 py-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <BrandMark size={22} />

        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          {FOOTER_LINKS.map((link) =>
            link.href ? (
              <Link
                key={link.label}
                href={link.href}
                className="text-[13px] font-semibold text-on-spruce-muted transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            ) : (
              <span
                key={link.label}
                className="cursor-default text-[13px] font-semibold text-on-spruce-muted"
              >
                {link.label}
              </span>
            ),
          )}
        </nav>

        <p className="text-[12px] text-on-spruce-muted">
          © {new Date().getFullYear()} Wompy
        </p>
      </div>
    </footer>
  );
}
