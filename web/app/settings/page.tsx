"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MODEL_KEY, readKey, readModel, saveKey } from "@/lib/text";

import { logout } from "../login/actions";

type Models = { default: string; models: { id: string; provider: string; name: string; server_key: boolean }[] };

const KEY_LINKS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
  xai: "https://console.x.ai",
  mistral: "https://console.mistral.ai/api-keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  openrouter: "https://openrouter.ai/settings/keys",
};

function KeyField({ provider, serverKey }: { provider: string; serverKey: boolean }) {
  const [saved, setSaved] = useState(false);
  const [value, setValue] = useState("");
  useEffect(() => setSaved(!!readKey(provider)), [provider]);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        saveKey(provider, value.trim());
        setValue("");
        setSaved(true);
      }}
    >
      <Input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={saved ? "Key saved in this browser" : `${provider} API key`}
        aria-label={`${provider} API key`}
        autoComplete="off"
        maxLength={512}
        className="h-9 max-w-xs font-mono"
      />
      <Button type="submit" size="sm" disabled={value.trim().length < 8}>Save</Button>
      {saved && (
        <Button type="button" size="sm" variant="ghost" onClick={() => (saveKey(provider, null), setSaved(false))}>
          Remove
        </Button>
      )}
      <span className="text-xs text-muted-foreground">
        {saved ? "Using your key." : serverKey ? "Optional: the server has a key." : "Required to use these models."}
        {KEY_LINKS[provider] && (
          <>
            {" "}
            <a href={KEY_LINKS[provider]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Get a key</a>
          </>
        )}
      </span>
    </form>
  );
}

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
