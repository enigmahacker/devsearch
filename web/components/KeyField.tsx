"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readKey, saveKey } from "@/lib/text";

export type Models = { default: string; models: { id: string; provider: string; name: string; server_key: boolean }[] };

export const KEY_LINKS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
  xai: "https://console.x.ai",
  mistral: "https://console.mistral.ai/api-keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  openrouter: "https://openrouter.ai/settings/keys",
};

/** Save/remove one provider's key in this browser. */
export function KeyField({ provider, serverKey, onChange }: { provider: string; serverKey: boolean; onChange?: (saved: boolean) => void }) {
  const [saved, setSaved] = useState(false);
  const [value, setValue] = useState("");
  useEffect(() => setSaved(!!readKey(provider)), [provider]);
  const set = (v: boolean) => (setSaved(v), onChange?.(v));
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        saveKey(provider, value.trim());
        setValue("");
        set(true);
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
        <Button type="button" size="sm" variant="ghost" onClick={() => (saveKey(provider, null), set(false))}>
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
