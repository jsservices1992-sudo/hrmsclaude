import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { COMPANY_COOKIE, readSelectedCompany } from "@/lib/company-cookie";

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

  /* The company chosen in the header. A page asked for with ?company=
     makes that the choice (so the header and the page never disagree);
     a page asked for without one is served as if it carried the current
     choice, which is what lets every page drop its own company picker.
     Only page loads — never a form post — and only ever narrowing:
     each page still checks the user may see that company. */
  const url = request.nextUrl;
  if (request.method === "GET" && url.pathname.startsWith("/console")) {
    const asked = url.searchParams.get("company");
    if (asked !== null) {
      const res = NextResponse.next();
      res.cookies.set(COMPANY_COOKIE, asked || "all", {
        path: "/",
        sameSite: "lax",
        httpOnly: false,
        maxAge: 60 * 60 * 24 * 365,
      });
      return res;
    }
    const chosen = readSelectedCompany(request.cookies.get(COMPANY_COOKIE)?.value);
    if (chosen) {
      const rewritten = url.clone();
      rewritten.searchParams.set("company", chosen);
      return NextResponse.rewrite(rewritten);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/console/:path*", "/me/:path*"],
};
