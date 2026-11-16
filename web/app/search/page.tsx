import { AnswerPanel } from "@/components/AnswerPanel";
import { CodeBlock } from "@/components/CodeBlock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { headers as requestHeaders } from "next/headers";

import { apiHeaders } from "@/lib/auth";
import { SOURCE_LABEL, ago, safeUrl, snippet } from "@/lib/text";

const API = process.env.API_URL ?? "http://localhost:8000";

type Result = {
  chunk_id: string;
  url: string;
  title: string;
  source: string;
  framework: string;
  version: string;
  updated_at: string | null;
  text: string;
};
type Filters = { frameworks: { name: string; versions: string[] }[] };

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(API + path, { cache: "no-store", headers: apiHeaders(await requestHeaders()) });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

const selectCls =
  "h-11 rounded-xl border border-input bg-background/40 px-3 text-sm shadow-xs backdrop-blur transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; framework?: string; version?: string }>;
}) {
  const { q = "", framework = "", version = "" } = await searchParams;
  const filters = await get<Filters>("/filters");
  const params = new URLSearchParams({ q });
  if (framework) params.set("framework", framework);
  if (version) params.set("version", version);
  const data = q.trim() ? await get<{ results: Result[] }>(`/search?${params}`) : null;
  const versions =
    filters?.frameworks.find((f) => f.name === framework)?.versions ??
    [...new Set(filters?.frameworks.flatMap((f) => f.versions) ?? [])];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <section className={`animate-in fade-in slide-in-from-bottom-3 duration-700 ${q.trim() ? "mb-6" : "mt-[12vh] mb-10 text-center"}`}>
        {!q.trim() && <p className="kicker mb-3">Docs · GitHub · Stack Overflow</p>}
        <h1 className={`text-gradient tracking-tight ${q.trim() ? "text-2xl font-semibold" : "text-5xl font-extrabold leading-[1.02] sm:text-7xl"}`}>
          Search every doc.{!q.trim() && <br />} Get cited answers.
        </h1>
        <p className={`mt-3 text-muted-foreground ${q.trim() ? "text-sm" : "mx-auto max-w-xl text-base sm:text-lg"}`}>
          One search across the sources developers trust. Every claim links back to where it came from.
        </p>
      </section>

      <form action="/search" className="glass animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-2 rounded-2xl p-2 delay-150 duration-700 fill-mode-both sm:flex-row">
        <Input name="q" defaultValue={q} placeholder="e.g. useEffect cleanup" aria-label="Search query" maxLength={500} required className="h-11 rounded-xl border-transparent bg-transparent text-base" />
        <select name="framework" defaultValue={framework} aria-label="Framework" className={selectCls}>
          <option value="">All frameworks</option>
          {filters?.frameworks.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
        <select name="version" defaultValue={version} aria-label="Version" className={selectCls}>
          <option value="">Any version</option>
          {versions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <Button type="submit" className="h-11 rounded-xl px-6 transition-transform active:scale-95">Search</Button>
      </form>

      {!q.trim() && (
        <div className="animate-in fade-in mx-auto mt-10 max-w-2xl delay-300 duration-700 fill-mode-both">
          <ul className="grid gap-3 text-sm sm:grid-cols-2">
            {["Bring your own AI key", "Claude, GPT, Gemini & more", "Runs 100% on your machine", "One-command ds update"].map((f) => (
              <li key={f} className="feature">{f}</li>
            ))}
          </ul>
          <div className="glass mt-6 flex items-center justify-between gap-4 rounded-xl px-4 py-3 font-mono text-sm">
            <span><span className="text-primary">$</span> npm i -g @aryptn/devsearch &amp;&amp; <span className="text-[var(--link)]">ds</span></span>
            <span className="hidden font-sans text-xs text-muted-foreground sm:inline">MIT · open source</span>
          </div>
        </div>
      )}

      {filters === null && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          The search API is unreachable. Check that it is running and API_URL is set.
        </p>
      )}

      {q.trim() && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_400px]">
          <section aria-label="Results" className="min-w-0 space-y-3">
            {data?.results.length ? (
              data.results.map((r, i) => {
                const s = snippet(r.text);
                return (
                  <Card
                    key={r.chunk_id}
                    className="glass lift animate-in fade-in slide-in-from-bottom-2 gap-2 p-4 duration-500 fill-mode-both"
                    style={{ animationDelay: `${Math.min(i, 10) * 60}ms` }}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant={r.source === "docs" ? "default" : "secondary"}>{SOURCE_LABEL[r.source] ?? r.source}</Badge>
                      <Badge variant="outline">
                        {r.framework}
                        {r.version !== "any" && ` ${r.version}`}
                      </Badge>
                      <span className="text-muted-foreground">updated {ago(r.updated_at)}</span>
                    </div>
                    <a href={safeUrl(r.url)} target="_blank" rel="noopener noreferrer" className="font-medium transition-colors hover:text-[var(--link)]">
                      {r.title}
                    </a>
                    {s.prose && <p className="text-sm text-muted-foreground">{s.prose}</p>}
                    {s.code && <CodeBlock code={s.code.code} lang={s.code.lang} />}
                  </Card>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">{data ? "No results. Try other words or widen the filters." : "Search failed, or you are searching too fast. Try again in a minute."}</p>
            )}
          </section>
          <aside className="order-first lg:order-last">
            <AnswerPanel key={`${q}|${framework}|${version}`} q={q} framework={framework || null} version={version || null} />
          </aside>
        </div>
      )}
    </main>
  );
}
