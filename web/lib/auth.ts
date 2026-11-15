// Password login with an HMAC-signed session cookie. Web Crypto only, so it runs in middleware (edge) and server actions.
export const SESSION_COOKIE = "ds_session";
export const SESSION_TTL = 60 * 60 * 24 * 7; // seconds

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** "on" = login required, "off" = open (dev or AUTH_DISABLED=1), "misconfigured" = production without secrets: fail closed. */
export function authMode(): "on" | "off" | "misconfigured" {
  if (process.env.AUTH_PASSWORD && (process.env.AUTH_SECRET?.length ?? 0) >= 32) return "on";
  if (process.env.AUTH_DISABLED === "1" || process.env.NODE_ENV !== "production") return "off";
  return "misconfigured";
}

const key = () =>
  crypto.subtle.importKey("raw", enc.encode(process.env.AUTH_SECRET!), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function createSession(): Promise<string> {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_TTL);
  return `${exp}.${b64url(await crypto.subtle.sign("HMAC", await key(), enc.encode(exp)))}`;
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  const [exp, sig] = token?.split(".") ?? [];
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  try {
    return await crypto.subtle.verify("HMAC", await key(), unb64url(sig), enc.encode(exp));
  } catch {
    return false;
  }
}

/** Constant-time password check: verify() compares HMAC(input) with HMAC(password). */
export async function checkPassword(input: string): Promise<boolean> {
  const k = await key();
  const expected = await crypto.subtle.sign("HMAC", k, enc.encode(`pw:${process.env.AUTH_PASSWORD}`));
  return crypto.subtle.verify("HMAC", k, expected, enc.encode(`pw:${input}`));
}

/** Only same-site relative paths, so ?next= cannot redirect off-site. */
export const safeNext = (next: unknown) =>
  typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/search";

/** Visitor IP as set by Vercel (x-real-ip), for per-IP rate limits in the API. */
export const clientIp = (h: Headers) => h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

/** Headers for server-to-API calls: the shared token plus the visitor IP the API rate-limits on. */
export function apiHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  if (process.env.API_TOKEN) out.authorization = `Bearer ${process.env.API_TOKEN}`;
  const ip = clientIp(h);
  if (ip) out["x-client-ip"] = ip;
  return out;
}
