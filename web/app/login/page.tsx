"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { login } from "./actions";

function LoginForm() {
  const [error, action, pending] = useActionState(login, null);
  const next = useSearchParams().get("next") ?? "/search";
  return (
    <form action={action} className="glass animate-in fade-in slide-in-from-bottom-4 w-full max-w-sm space-y-4 rounded-2xl p-8 duration-700">
      <div>
        <h1 className="text-gradient text-2xl font-semibold tracking-tight">DevSearch</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to continue.</p>
      </div>
      <input type="hidden" name="next" value={next} />
      <Input type="password" name="password" placeholder="Password" aria-label="Password" autoComplete="current-password" maxLength={256} required autoFocus />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-[80vh] place-items-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
