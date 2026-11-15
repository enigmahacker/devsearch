export type Segment = { kind: "text"; text: string } | { kind: "code"; lang: string; code: string };

/** Splits markdown into prose and fenced code blocks. */
export function segments(md: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of md.matchAll(/```([\w+-]*)\n([\s\S]*?)```/g)) {
    if (m.index > last) out.push({ kind: "text", text: md.slice(last, m.index) });
    out.push({ kind: "code", lang: m[1] || "text", code: m[2].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < md.length) out.push({ kind: "text", text: md.slice(last) });
  return out;
}

/** A short prose excerpt plus the first code block (if any) of a chunk. */
export function snippet(text: string) {
  const segs = segments(text);
  const prose = segs
    .flatMap((s) => (s.kind === "text" ? [s.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const code = segs.find((s) => s.kind === "code");
  return {
    prose: prose.length > 300 ? `${prose.slice(0, 300)}…` : prose,
    code: code && code.kind === "code" ? { lang: code.lang, code: code.code.split("\n").slice(0, 12).join("\n") } : null,
  };
}

export function ago(iso?: string | null): string {
  if (!iso) return "date unknown";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 864e5);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (days < 30) return rtf.format(-days, "day");
  if (days < 365) return rtf.format(-Math.round(days / 30), "month");
  return rtf.format(-Math.round(days / 365), "year");
}

export const SOURCE_LABEL: Record<string, string> = {
  docs: "Official docs",
  github: "GitHub",
  stackoverflow: "Stack Overflow",
};

export const MODEL_KEY = "devsearch:model";

/** The answer model picked in Settings, or null (server default). */
export function readModel(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

/** Crawled URLs are untrusted: only http(s) links get an href. */
export const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : undefined);

// Visitor-supplied provider keys. They live only in this browser and go to the API with each question.
const keyName = (provider: string) => `devsearch:key:${provider}`;

export function readKey(provider: string): string | null {
  try {
    return localStorage.getItem(keyName(provider));
  } catch {
    return null;
  }
}

export function saveKey(provider: string, key: string | null) {
  try {
    if (key) localStorage.setItem(keyName(provider), key);
    else localStorage.removeItem(keyName(provider));
  } catch {} // private mode: the key just won't persist
}
