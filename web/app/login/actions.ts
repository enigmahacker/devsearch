"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, SESSION_TTL, apiHeaders, authMode, checkPassword, createSession, safeNext } from "@/lib/auth";

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const next = safeNext(form.get("next"));
  if (authMode() !== "on") redirect(next);
  // Per-IP attempt cap lives in the API's Redis (serverless functions share no memory). Fails closed.
  const gate = await fetch(`${process.env.API_URL ?? "http://localhost:8000"}/login-attempt`, {
    method: "POST",
    headers: apiHeaders(await headers()),
    cache: "no-store",
  }).catch(() => null);
  if (gate?.status === 429) return "Too many attempts. Try again in a few minutes.";
  if (!gate?.ok) return "Sign-in is temporarily unavailable.";
  const password = form.get("password");
  if (typeof password !== "string" || password.length > 256 || !(await checkPassword(password))) {
    await new Promise((r) => setTimeout(r, 400));
    return "Wrong password.";
  }
  (await cookies()).set(SESSION_COOKIE, await createSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
  redirect(next);
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
