"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { CodeBlock } from "@/components/CodeBlock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SOURCE_LABEL, readKey, readModel, safeUrl, segments } from "@/lib/text";

type Citation = { n: number; url: string; title: string; source: string; version: string };
type Turn = { q: string; model?: string; found: boolean; answer: string | null; citations: Citation[] };

function AnswerText({ text, turn }: { text: string; turn: number }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {segments(text).map((s, i) =>
        s.kind === "code" ? (
          <CodeBlock key={i} code={s.code} lang={s.lang} />
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {s.text.trim().split(/(\[\d+\])/).map((part, j) => {
              const m = part.match(/^\[(\d+)\]$/);
              return m ? (
                <a key={j} href={`#cite-${turn}-${m[1]}`} className="align-super text-xs font-medium text-[var(--link)] hover:underline">
                  [{m[1]}]
                </a>
              ) : (
                part
              );
            })}
          </p>
        ),
      )}
    </div>
  );
}

export function AnswerPanel({ q, framework, version }: { q: string; framework: string | null; version: string | null }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  const started = useRef(false);

  const ask = useCallback(
    async (question: string, conversationId: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const model = readModel();
        // shortcut: with no model picked we assume the server default is Claude; a non-Claude DEFAULT_MODEL needs a pick in Settings.
        const apiKey = readKey((model ?? "anthropic:").split(":")[0]);
        const r = await fetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: question, framework, version, conversation_id: conversationId, model, api_key: apiKey }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Request failed (${r.status})`);
        setConvId(body.conversation_id);
        setTurns((t) => [...t, { q: question, ...body }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [framework, version],
  );

  useEffect(() => {
    if (started.current) return; // Strict Mode runs effects twice in dev; each answer costs a model call
    started.current = true;
    ask(q, null);
  }, [q, ask]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const question = followUp.trim();
    if (!question || loading) return;
    setFollowUp("");
    ask(question, convId);
  }

  return (
    <Card className="glass animate-in fade-in slide-in-from-right-4 gap-4 p-4 duration-700 lg:sticky lg:top-20">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="logo-dot" aria-hidden />
        AI answer
        {turns.at(-1)?.model && <span className="ml-auto font-mono text-xs font-normal text-muted-foreground">{turns.at(-1)!.model}</span>}
      </h2>
      {turns.map((t, i) => (
        <div key={i} className="animate-in fade-in slide-in-from-bottom-1 space-y-3 border-t pt-3 duration-500 first-of-type:border-t-0 first-of-type:pt-0">
          {i > 0 && <p className="text-sm font-medium">{t.q}</p>}
          {t.found && t.answer ? (
            <>
              <AnswerText text={t.answer} turn={i} />
              <ol className="space-y-1.5 text-xs" aria-label="Sources">
                {t.citations.map((c) => (
                  <li key={c.n} id={`cite-${i}-${c.n}`} className="flex flex-wrap items-center gap-1.5 rounded px-1 transition-colors target:bg-primary/20">
                    <span className="font-medium">[{c.n}]</span>
                    <Badge variant="secondary">{SOURCE_LABEL[c.source] ?? c.source}</Badge>
                    <a href={safeUrl(c.url)} target="_blank" rel="noopener noreferrer" className="text-[var(--link)] hover:underline">
                      {c.title}
                    </a>
                    {c.version && c.version !== "any" && <span className="text-muted-foreground">v{c.version}</span>}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not found in sources. Try other words or widen the filters.</p>
          )}
        </div>
      ))}
      {loading && (
        <p className="shimmer text-sm" aria-live="polite">
          Reading sources…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
          {/API key/.test(error) && (
            <>
              {" "}
              <Link href="/settings" className="underline underline-offset-2">
                Open Settings
              </Link>
            </>
          )}
        </p>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          placeholder="Ask a follow-up"
          aria-label="Follow-up question"
          maxLength={500}
          disabled={!convId}
        />
        <Button type="submit" disabled={loading || !convId || !followUp.trim()}>
          Ask
        </Button>
      </form>
    </Card>
  );
}
