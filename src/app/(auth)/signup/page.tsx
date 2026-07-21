import { redirect } from "next/navigation";

/**
 * There is no separate sign-up any more — one form handles both. The route
 * stays so existing links and bookmarks don't 404, and forwards to the same
 * place, preserving any prefilled address.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.email;
  const email = Array.isArray(raw) ? raw[0] : raw;

  redirect(email ? `/login?email=${encodeURIComponent(email)}` : "/login");
}
