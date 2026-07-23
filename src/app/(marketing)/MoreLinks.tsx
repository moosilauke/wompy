import Link from "next/link";
import { MORE_LINKS } from "./content";

/**
 * The rail's collapsible "More" section.
 *
 * Built on <details>/<summary> rather than React state, so it expands with no
 * JavaScript at all — the chevron rotation comes from a CSS sibling selector on
 * [open]. On a landing page a disclosure widget is not worth a hydration
 * boundary.
 *
 * Most links are inert: About us, Documentation, and the rest don't have pages
 * yet, and pointing them at 404s would be worse than pointing them nowhere.
 * Only ones with an `href` in MORE_LINKS are real.
 */
export function MoreLinks() {
  return (
    <details className="group shrink-0 border-t border-spruce-edge px-2 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-3 py-2 text-[13px] font-bold text-on-spruce-muted transition-colors hover:text-white">
        More
        <span
          aria-hidden
          className="text-[14px] transition-transform duration-150 group-open:rotate-180"
        >
          ⌄
        </span>
      </summary>

      <ul className="flex flex-col pb-1 pt-0.5">
        {MORE_LINKS.map((link) => (
          <li key={link.label}>
            {link.href ? (
              <Link
                href={link.href}
                className="block px-3 py-1.5 text-[12.5px] font-semibold text-on-spruce-muted transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            ) : (
              <span className="block cursor-default px-3 py-1.5 text-[12.5px] font-semibold text-on-spruce-muted">
                {link.label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
