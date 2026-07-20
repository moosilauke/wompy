import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildConsentUrl } from "@/lib/gmail/auth";

/**
 * Kicks off the Gmail OAuth flow. Requires a signed-in Wompy user; passes their
 * user id through the OAuth `state` so the callback can attribute the tokens.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      new URL("/login", process.env.NEXT_PUBLIC_APP_URL),
    );
  }

  const consentUrl = buildConsentUrl(user.id);
  return NextResponse.redirect(consentUrl);
}
