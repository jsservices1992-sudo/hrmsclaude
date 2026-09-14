import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Optimistic gate only — it checks that a session cookie is PRESENT, not that
 * it is valid. Per the Next.js docs, proxy is not a session-management layer.
 * Real authorisation happens in the console layout via getSessionUser(),
 * which hits the database; this just avoids rendering a protected route for
 * an obviously signed-out visitor.
 */
export function proxy(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/console/:path*", "/me/:path*"],
};
