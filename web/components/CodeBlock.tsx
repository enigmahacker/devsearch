"use client";

import { useEffect, useState } from "react";

/** Shiki-highlighted code; shows plain text until the highlighter loads. */
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    import("shiki")
      .then(async ({ codeToHtml, bundledLanguages }) => {
        const out = await codeToHtml(code, { lang: lang in bundledLanguages ? lang : "text", theme: "github-dark-default" });
        if (live) setHtml(out);
      })
      .catch(() => {}); // plain <pre> stays as the fallback
    return () => {
      live = false;
    };
  }, [code, lang]);

  const box = "text-[13px] leading-relaxed rounded-lg border overflow-x-auto";
  if (!html)
    return (
      <pre className={`${box} bg-muted p-3`}>
        <code>{code}</code>
      </pre>
    );
  // Shiki escapes the code it renders, so this HTML is safe to inject.
  return <div className={`${box} [&_pre]:p-3`} dangerouslySetInnerHTML={{ __html: html }} />;
}
