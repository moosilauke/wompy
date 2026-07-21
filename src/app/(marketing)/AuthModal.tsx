"use client";

import { Suspense } from "react";
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
  const open = searchParams.get("auth") === "1";

  const close = () => {
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
