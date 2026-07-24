import { NextResponse } from "next/server";
import { sendContactFormEmail } from "@/lib/email/templates";

const MAX_MESSAGE_LENGTH = 4000;

/**
 * Get Help contact form submission. Public — no auth required, since a
 * visitor who can't sign in is exactly who needs this.
 */
export async function POST(request: Request) {
  let payload: { name?: string; email?: string; message?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = (payload.name ?? "").trim();
  const email = (payload.email ?? "").trim();
  const message = (payload.message ?? "").trim();

  if (!name || !email || !message) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: "too_long", limit: MAX_MESSAGE_LENGTH },
      { status: 400 },
    );
  }

  const result = await sendContactFormEmail({ name, email, message });
  if (!result.ok) {
    return NextResponse.json(
      { error: "send_failed", detail: result.reason },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
