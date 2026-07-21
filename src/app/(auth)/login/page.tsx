import { Suspense } from "react";
import { AuthForm } from "../AuthForm";

/**
 * Standalone auth page.
 *
 * The primary path is the modal over the landing page; this route stays because
 * several things still need somewhere to land: the proxy's redirect when a
 * signed-out user hits a protected route, the OAuth callback's error path, and
 * email-confirmation links. Same unified form either way.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <div className="w-full max-w-sm">
        <h1 className="mb-1 font-display text-2xl font-bold">Get started</h1>
        <p className="mb-6 text-sm text-text-muted">
          Sign in, or create an account — same form.
        </p>
        <AuthForm />
      </div>
    </Suspense>
  );
}
