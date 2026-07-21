import Link from "next/link";

/**
 * The header's Log in / Sign up controls.
 *
 * Plain links to `/?auth=1` rather than buttons with click handlers: the modal's
 * open state is already in the URL, so a link expresses it directly, works with
 * middle-click and keyboard, and needs no JavaScript to function. `scroll={false}`
 * keeps the pitch feed where it is.
 */
export function AuthTrigger() {
  return (
    <div className="flex items-center gap-4">
      <Link
        href="/?auth=1"
        scroll={false}
        className="text-[13px] font-bold text-on-spruce-muted transition-colors hover:text-white"
      >
        Log in
      </Link>
      <Link
        href="/?auth=1"
        scroll={false}
        className="rounded-full bg-coral px-[18px] py-[9px] text-[13px] font-extrabold text-white shadow-[0_4px_12px_oklch(0.5_0.12_25_/_0.4)] transition-opacity hover:opacity-90"
      >
        Sign up free
      </Link>
    </div>
  );
}
