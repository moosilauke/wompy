"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { AuthForm } from "@/app/(auth)/AuthForm";

/**
 * Sign-in / sign-up presented over the landing page.
 *
 * The landing page was built to BE the app shell, with no visual seam between
 * the marketing site and the logged-in app. Navigating to a separate bare auth
 * page mid-conversion is exactly that seam, so the form opens in place instead.
 *
 * Open state lives in the URL (`?auth=1`) rather than React state, which keeps
 * it linkable and lets the server redirect into it — sign-out lands on
 * `/?auth=1`. Reading it with useSearchParams keeps the surrounding page a
 * server component, so the landing page stays statically prerendered.
 */
export function AuthModal() {
  return (
    // useSearchParams needs a Suspense boundary to avoid opting the route into
    // dynamic rendering.
    <Suspense fallback={null}>
      <AuthModalInner />
    </Suspense>
  );
}

function AuthModalInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramsOpen = searchParams.get("auth") === "1";

  // Mirrored into state rather than read directly from the URL: `/` is
  // statically prerendered, and next.config's staleTimes keeps its client
  // Router Cache entry fresh for 180s. router.replace("/") after closing
  // targets that same cached pathname, so on a soft navigation the cache can
  // serve the stale (still-open) subtree back without ever re-deriving `open`
  // from the new searchParams — the URL updates but the modal doesn't close.
  // Local state closes it immediately regardless of what the cache does.
  //
  // Derived during render (React's documented pattern for "external prop
  // changed, resync state") rather than in an effect, so the URL still wins
  // when it disagrees with the last local close — e.g. Back to a `?auth=1`
  // history entry, or the server redirecting a signed-out user here.
  const [open, setOpen] = useState(paramsOpen);
  const [lastParamsOpen, setLastParamsOpen] = useState(paramsOpen);
  if (paramsOpen !== lastParamsOpen) {
    setLastParamsOpen(paramsOpen);
    setOpen(paramsOpen);
  }

  const close = () => {
    setOpen(false);
    // Drop the auth params but keep anything else on the URL.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("auth");
    params.delete("email");
    const query = params.toString();
    router.replace(query ? `/?${query}` : "/", { scroll: false });
  };

  return (
    <Modal open={open} onClose={close} label="Sign in to Wompy" maxWidth={420}>
      <div className="flex items-start justify-between gap-4 px-6 pb-1 pt-5">
        <div>
          <h2 className="font-display text-[20px] font-bold text-text-body">
            Get started
          </h2>
          <p className="mt-0.5 text-[13px] text-text-muted">
            Sign in, or create an account — same form.
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="shrink-0 rounded-full px-3 py-1 text-[13px] font-bold text-text-muted transition-colors hover:bg-black/[0.05] hover:text-text-body"
        >
          Close
        </button>
      </div>

      <div className="overflow-y-auto px-6 pb-6 pt-3">
        <AuthForm />
      </div>
    </Modal>
  );
}
