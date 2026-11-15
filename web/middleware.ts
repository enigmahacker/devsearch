import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE, apiHeaders, authMode, verifySession } from "@/lib/auth";

const API = process.env.API_URL ?? "http://localhost:8000";
const dev = process.env.NODE_ENV !== "production";

function csp(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // Shiki and React style attributes
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'", // HTTPS is enforced by HSTS (next.config.ts) and Vercel, not upgrade-insecure-requests
  ].join("; ");
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const mode = authMode();
  if (mode === "misconfigured") return new NextResponse("Auth is not configured (set AUTH_PASSWORD and AUTH_SECRET).", { status: 503 });

  const authed = mode === "off" || (await verifySession(req.cookies.get(SESSION_COOKIE)?.value));
  const isApi = pathname.startsWith("/api/");

  if (!authed && pathname !== "/login") {
    if (isApi) return NextResponse.json({ detail: "Sign in required" }, { status: 401 });
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if (isApi) {
    // Append to the API base (never resolve against it: "/api//evil.com" would change host) and pin the origin
    // before the server-only token is attached.
    const base = new URL(API);
    const target = new URL(base);
    target.pathname = base.pathname.replace(/\/$/, "") + "/" + pathname.slice(5).replace(/^[/\\]+/, "");
    target.search = search;
    if (target.origin !== base.origin || pathname.includes("\\")) return NextResponse.json({ detail: "Bad path" }, { status: 400 });

    // Proxy to FastAPI with the server-only token; the browser's cookies never leave this origin.
    const headers = new Headers({ accept: "application/json", ...apiHeaders(req.headers) });
    const type = req.headers.get("content-type");
    if (type) headers.set("content-type", type);
    return NextResponse.rewrite(target, { request: { headers } });
  }

  const nonce = btoa(crypto.randomUUID());
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp(nonce)); // Next reads the nonce from this request header
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp(nonce));
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|llms.txt|\\.well-known/).*)"],
};
