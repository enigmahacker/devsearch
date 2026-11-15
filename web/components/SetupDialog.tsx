"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { KeyField, type Models } from "@/components/KeyField";
import { Button } from "@/components/ui/button";
import { MODEL_KEY, readKey, readModel } from "@/lib/text";

const DONE = "devsearch:setup-done";

function remember(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {} // private mode: the popup just shows again next visit
}

/** First-run popup: pick an AI provider and model, add a key. Shown until finished or skipped. */
export function SetupDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const path = usePathname();
  const [data, setData] = useState<Models | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    if (path === "/login" || path === "/settings") return;
    try {
      if (localStorage.getItem(DONE)) return;
    } catch {
      return;
    }
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Models) => {
        const first = d.models.find((m) => m.id === (readModel() ?? d.default)) ?? d.models[0];
        if (!first) return;
        // Already usable: the chosen model has a key here, a server key, or is a (possibly keyless) custom server.
        if (first.server_key || readKey(first.provider) || first.provider === "custom") return remember(DONE, "1");
        setData(d);
        setProvider(first.provider);
        setModel(first.id);
        ref.current?.showModal();
      })
      .catch(() => {}); // API down: the search page shows its own error
  }, [path]);

  const close = () => (remember(DONE, "1"), ref.current?.close());
  const pick = (p: string) => {
    setProvider(p);
    setModel(data!.models.find((m) => m.provider === p)!.id);
    setHasKey(!!readKey(p));
  };
  const providers = [...new Set(data?.models.map((m) => m.provider))];
  const needsKey = provider !== "custom";

  return (
    <dialog
      ref={ref}
      aria-labelledby="setup-title"
      onCancel={close}
      className="glass m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border p-0 text-foreground backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-in open:fade-in open:zoom-in-95"
    >
      {data && (
        <div className="space-y-5 p-6">
          <div className="space-y-1">
            <h2 id="setup-title" className="text-gradient text-xl font-semibold tracking-tight">Set up your AI provider</h2>
            <p className="text-sm text-muted-foreground">
              Answers use your own API key. It stays in this browser and is sent only with each question.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">Provider</legend>
            <div className="flex flex-wrap gap-2">
              {providers.map((p) => (
                <Button key={p} type="button" size="sm" variant={p === provider ? "default" : "outline"} aria-pressed={p === provider} onClick={() => pick(p)}>
                  {p}
                </Button>
              ))}
            </div>
          </fieldset>

          <label className="block space-y-2">
            <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Model</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 w-full rounded-md border bg-transparent px-3 font-mono text-sm"
            >
              {data.models.filter((m) => m.provider === provider).map((m) => (
                <option key={m.id} value={m.id} className="bg-background">{m.name}</option>
              ))}
            </select>
          </label>

          {needsKey && (
            <div className="space-y-2">
              <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">API key</span>
              <KeyField key={provider} provider={provider} serverKey={false} onChange={setHasKey} />
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <Link href="/settings" onClick={close} className="text-xs text-muted-foreground underline underline-offset-2">
              All settings
            </Link>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={close}>Skip</Button>
              <Button type="button" disabled={needsKey && !hasKey} onClick={() => (remember(MODEL_KEY, model), close())}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
