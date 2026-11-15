"use client";

import { useEffect, useState } from "react";

import { KeyField, type Models } from "@/components/KeyField";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MODEL_KEY, readModel } from "@/lib/text";

import { logout } from "../login/actions";

export default function SettingsPage() {
  const [data, setData] = useState<Models | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState("");

  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
      .then((d: Models) => {
        setData(d);
        const saved = readModel();
        setModel(saved && d.models.some((m) => m.id === saved) ? saved : d.default);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  function choose(id: string) {
    setModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {} // private mode: the choice just won't persist
  }

  const providers = [...new Set(data?.models.map((m) => m.provider))];
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <h1 className="text-gradient animate-in fade-in text-3xl font-semibold tracking-tight duration-500">Settings</h1>

      <Card className="glass animate-in fade-in slide-in-from-bottom-2 gap-4 p-6 duration-500">
        <div>
          <h2 className="font-semibold">Answer model</h2>
          <p className="text-sm text-muted-foreground">
            Add your own API key for the provider you want; answers are billed to your account. Keys stay in this browser and go
            to our server only with each question, where they are used for that call and never stored or logged.
          </p>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {providers.map((p) => (
          <fieldset key={p} className="space-y-2">
            <legend className="mb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">{p}</legend>
            {p !== "custom" && <KeyField provider={p} serverKey={data!.models.some((m) => m.provider === p && m.server_key)} />}
            <div className="grid gap-2 sm:grid-cols-2">
              {data!.models
                .filter((m) => m.provider === p)
                .map((m) => (
                  <label
                    key={m.id}
                    className="interactive flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors has-checked:border-primary has-checked:bg-primary/10"
                  >
                    <input type="radio" name="model" value={m.id} checked={model === m.id} onChange={() => choose(m.id)} className="accent-[var(--primary)]" />
                    <span className="font-mono">{m.name}</span>
                    {m.id === data!.default && <span className="ml-auto text-xs text-muted-foreground">default</span>}
                  </label>
                ))}
            </div>
          </fieldset>
        ))}
      </Card>

      <Card className="glass animate-in fade-in slide-in-from-bottom-2 gap-3 p-6 delay-100 duration-500 fill-mode-both">
        <h2 className="font-semibold">Session</h2>
        <p className="text-sm text-muted-foreground">Sessions last 7 days. Rotate AUTH_SECRET on the server to sign everyone out.</p>
        <form action={logout}>
          <Button type="submit" variant="outline">Sign out</Button>
        </form>
      </Card>
    </main>
  );
}
