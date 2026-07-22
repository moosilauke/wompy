import { notFound } from "next/navigation";
import { getAdminContext } from "@/lib/admin/guard";
import { listUsers } from "@/lib/admin/users";
import { AdminUserTable } from "./AdminUserTable";

/**
 * Admin panel.
 *
 * notFound() for anyone who isn't a verified admin — not a redirect, not a 403.
 * A redirect or a 403 both confirm the route exists; a 404 says nothing does,
 * which is the point: non-admins shouldn't be able to tell the panel is here.
 */
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const ctx = await getAdminContext();
  if (!ctx) notFound();

  const users = await listUsers();

  return (
    <div className="min-h-screen bg-cream px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="font-display text-2xl font-bold text-text-body">
            Admin
          </h1>
          <a
            href="/app"
            className="text-[13px] font-bold text-text-muted transition-colors hover:text-text-body"
          >
            ← Back to app
          </a>
        </div>

        <p className="mb-5 text-sm text-text-muted">
          {users.length} {users.length === 1 ? "user" : "users"}
        </p>

        <AdminUserTable users={users} currentUserId={ctx.userId} />
      </div>
    </div>
  );
}
