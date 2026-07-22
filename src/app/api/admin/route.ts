import { NextResponse } from "next/server";
import { getAdminContext } from "@/lib/admin/guard";
import {
  deleteUser,
  sendPasswordReset,
  setAdmin,
  AdminActionError,
} from "@/lib/admin/users";

/**
 * Admin actions endpoint.
 *
 * getAdminContext() is the first thing every request does — it verifies the JWT
 * and confirms is_admin server-side. A non-admin (or signed-out) request gets a
 * 404, identical to hitting a route that doesn't exist, so probing this URL
 * reveals nothing about whether an admin panel exists.
 *
 * Body: { action: "delete" | "make-admin" | "remove-admin" | "reset-password",
 *         userId?, email? }
 */
export async function POST(request: Request) {
  const ctx = await getAdminContext();
  if (!ctx) {
    // 404, not 403: a 403 would confirm the endpoint exists and is admin-gated.
    return new NextResponse("Not found", { status: 404 });
  }

  let payload: {
    action?: string;
    userId?: string;
    email?: string;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    switch (payload.action) {
      case "delete":
        if (!payload.userId) {
          return NextResponse.json({ error: "missing_user" }, { status: 400 });
        }
        await deleteUser(ctx.userId, payload.userId);
        break;

      case "make-admin":
        if (!payload.userId) {
          return NextResponse.json({ error: "missing_user" }, { status: 400 });
        }
        await setAdmin(payload.userId, true);
        break;

      case "remove-admin":
        if (!payload.userId) {
          return NextResponse.json({ error: "missing_user" }, { status: 400 });
        }
        await setAdmin(payload.userId, false);
        break;

      case "reset-password":
        if (!payload.email) {
          return NextResponse.json({ error: "missing_email" }, { status: 400 });
        }
        await sendPasswordReset(payload.email);
        break;

      default:
        return NextResponse.json(
          { error: "unsupported_action" },
          { status: 400 },
        );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    // A guard rejection (self-delete, last admin) is the user's to see; other
    // failures are surfaced generically.
    if (err instanceof AdminActionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: "action_failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
