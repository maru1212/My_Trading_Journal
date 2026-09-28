import { NextResponse, type NextRequest } from "next/server";

// Optimistic check on the session cookie only; pages verify the session in the database.
const PROTECTED = ["/dashboard", "/trades", "/calendar", "/analytics", "/settings", "/api"];
const AUTH_PAGES = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("tj_session");

  // The MT5 Expert Advisor authenticates with an API key, not a cookie.
  if (pathname.startsWith("/api/mt5/")) return NextResponse.next();

  if (!hasSession && PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (hasSession && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
