"""Ingestion CLI.

    uv run --env-file .env python -m workers.run                  # live crawl of SEEDS
    uv run --env-file .env python -m workers.run --fixtures       # offline fixture set
    uv run --env-file .env python -m workers.run --every 86400    # re-crawl daily (freshness)
"""
import argparse
import json
import time
from pathlib import Path

import httpx

from api.app import stores
from api.app.embed import DIM
from workers.connectors import docs, github, stackoverflow
from workers.pipeline.chunk_embed_index import index

CONNECTORS = {"docs": docs, "github": github, "stackoverflow": stackoverflow}

def _docs(framework: str, language: str, version: str, base: str, *paths: str) -> dict:
    return {"framework": framework, "language": language, "version": version, "urls": [base + p for p in paths]}


def _repo(repo: str, framework: str, language: str, version: str = "latest") -> dict:
    return {"repo": repo, "framework": framework, "language": language, "version": version}


# Verified sources only: official docs and each project's own GitHub repo, covering what DevSearch itself uses.
SEEDS = {
    "docs": [
        _docs("react", "javascript", "19", "https://react.dev/reference/react/",
              "useEffect", "useState", "useRef", "useCallback", "useActionState"),
        _docs("react", "javascript", "18", "https://legacy.reactjs.org/docs/", "hooks-effect.html", "hooks-state.html"),
        _docs("fastapi", "python", "latest", "https://fastapi.tiangolo.com/",
              "tutorial/dependencies/", "tutorial/background-tasks/", "advanced/events/", "tutorial/handling-errors/",
              "tutorial/query-params-str-validations/", "advanced/using-request-directly/", "tutorial/testing/",
              "tutorial/body/", "tutorial/dependencies/global-dependencies/"),
        _docs("pydantic", "python", "2", "https://pydantic.dev/docs/validation/latest/concepts/", "models/", "fields/"),
        _docs("httpx", "python", "latest", "https://www.python-httpx.org/",
              "quickstart/", "advanced/clients/", "advanced/timeouts/"),
        _docs("psycopg", "python", "3", "https://www.psycopg.org/psycopg3/docs/",
              "basic/usage.html", "advanced/prepare.html", "basic/params.html"),
        _docs("redis", "python", "latest", "https://redis.readthedocs.io/en/stable/", "advanced_features.html"),
        _docs("redis", "any", "latest", "https://redis.io/docs/latest/commands/", "incr/", "expire/"),
        _docs("claude-api", "python", "latest", "https://platform.claude.com/docs/en/api/", "messages", "errors"),
        _docs("uvicorn", "python", "latest", "https://uvicorn.dev/", "settings/"),
        _docs("python", "python", "3", "https://docs.python.org/3/library/",
              "urllib.robotparser.html", "html.parser.html", "hmac.html", "contextlib.html", "dataclasses.html",
              "hashlib.html", "argparse.html"),
        _docs("postgresql", "sql", "current", "https://www.postgresql.org/docs/current/", "ddl-rowsecurity.html", "sql-insert.html"),
        _docs("opensearch", "any", "2", "https://docs.opensearch.org/latest/",
              "query-dsl/compound/bool/", "query-dsl/full-text/multi-match/", "query-dsl/specialized/k-nn/index/",
              "api-reference/document-apis/bulk/"),
        _docs("qdrant", "any", "1", "https://qdrant.tech/documentation/",
              "search/search/", "search/filtering/", "manage-data/points/", "manage-data/collections/",
              "search/hybrid-queries/"),
        _docs("voyage", "python", "latest", "https://docs.voyageai.com/docs/", "embeddings"),
        # The app runs Next.js 15; v16 docs renamed middleware to proxy, so pin the versioned docs.
        _docs("next.js", "javascript", "15", "https://nextjs.org/docs/15/app/",
              "api-reference/file-conventions/middleware", "api-reference/functions/redirect",
              "api-reference/functions/cookies", "api-reference/functions/headers",
              "api-reference/functions/next-response", "api-reference/functions/use-pathname",
              "api-reference/functions/use-search-params", "api-reference/config/next-config-js/turbopack",
              "api-reference/config/next-config-js/headers", "api-reference/components/link",
              "api-reference/components/font", "guides/content-security-policy", "getting-started/updating-data"),
        _docs("tailwindcss", "css", "4", "https://tailwindcss.com/docs/", "installation/using-postcss", "theme", "dark-mode"),
        _docs("shiki", "javascript", "latest", "https://shiki.style/guide/", "install"),
        _docs("radix-ui", "javascript", "latest", "https://www.radix-ui.com/primitives/docs/", "overview/introduction"),
        _docs("shadcn-ui", "javascript", "latest", "https://ui.shadcn.com/", "docs"),
        _docs("cva", "javascript", "latest", "https://cva.style/", ""),
        _docs("lucide", "javascript", "latest", "https://lucide.dev/guide/", "react"),
        _docs("web-platform", "javascript", "any", "https://developer.mozilla.org/en-US/docs/Web/",
              "HTML/Reference/Elements/dialog", "API/SubtleCrypto/sign", "API/Window/localStorage", "HTTP/Guides/CSP",
              "API/Window/matchMedia", "API/Window/requestAnimationFrame"),
        _docs("node.js", "javascript", "latest", "https://nodejs.org/api/",
              "child_process.html", "net.html", "util.html", "fs.html"),
        _docs("docker-compose", "yaml", "latest", "https://docs.docker.com/reference/compose-file/", "services/"),
        _docs("uv", "python", "latest", "https://docs.astral.sh/uv/concepts/projects/", "run/"),
        _docs("github-api", "any", "2022-11-28", "https://docs.github.com/en/rest/repos/", "contents"),
        _docs("stack-exchange-api", "any", "2.3", "https://api.stackexchange.com/docs/", "questions"),
        _docs("robots-txt", "any", "rfc9309", "https://www.rfc-editor.org/rfc/", "rfc9309.html"),
    ],
    "github": [
        _repo("facebook/react", "react", "javascript", "19"),
        _repo("fastapi/fastapi", "fastapi", "python"),
        _repo("vercel/next.js", "next.js", "javascript", "15"),
        _repo("pydantic/pydantic", "pydantic", "python", "2"),
        _repo("encode/httpx", "httpx", "python"),
        _repo("psycopg/psycopg", "psycopg", "python", "3"),
        _repo("redis/redis-py", "redis", "python"),
        _repo("anthropics/anthropic-sdk-python", "claude-api", "python"),
        _repo("openai/openai-python", "openai-api", "python"),
        _repo("opensearch-project/OpenSearch", "opensearch", "any", "2"),
        _repo("qdrant/qdrant", "qdrant", "any", "1"),
        _repo("tailwindlabs/tailwindcss", "tailwindcss", "css", "4"),
        _repo("shikijs/shiki", "shiki", "javascript"),
        _repo("radix-ui/primitives", "radix-ui", "javascript"),
        _repo("shadcn-ui/ui", "shadcn-ui", "javascript"),
        _repo("lucide-icons/lucide", "lucide", "javascript"),
        _repo("joe-bell/cva", "cva", "javascript"),
        _repo("astral-sh/uv", "uv", "python"),
        _repo("Kludex/uvicorn", "uvicorn", "python"),
        _repo("nodejs/node", "node.js", "javascript"),
        _repo("docker/compose", "docker-compose", "yaml"),
        _repo("voyage-ai/voyageai-python", "voyage", "python"),
    ],
    "stackoverflow": [
        {"tag": "react-hooks", "framework": "react", "language": "javascript", "limit": 5},
        {"tag": "fastapi", "framework": "fastapi", "language": "python", "limit": 5},
    ],
}

FIXTURES = Path(__file__).parent / "fixtures" / "fixtures.json"


def _record(connector: str, key: str, error: str | None) -> None:
    with stores.pg() as c:
        c.execute(
            """insert into crawl_state values (%s, %s, now(), %s)
               on conflict (connector, key) do update set last_fetched = now(), error = excluded.error""",
            (connector, key, error),
        )


def run_fixtures() -> None:
    data = json.loads(FIXTURES.read_text())
    loaded = (
        [docs.parse(f["url"], f["html"], f["seed"]) for f in data["docs"]]
        + [github.parse(f["repo"], f["readme"], f.get("release"), f["seed"]) for f in data["github"]]
        + [stackoverflow.parse(f["question"], f["answers"], f["seed"]) for f in data["stackoverflow"]]
    )
    for doc in loaded:
        print(f"{doc.source:13} {index(doc):3} chunks  {doc.url}")
        _record(doc.source, doc.url, None)


def run_live(only: list[str]) -> None:
    with httpx.Client(timeout=60) as client:  # some docs sites (tailwindcss.com) take >30s for crawlers
        for name in only:
            for seed in SEEDS[name]:
                key = seed.get("repo") or seed.get("tag") or ",".join(seed["urls"])
                try:
                    for doc in CONNECTORS[name].fetch(seed, client):
                        print(f"{name:13} {index(doc):3} chunks  {doc.url}")
                    _record(name, key, None)
                except Exception as e:  # one bad seed must not stop the crawl; the error lands in crawl_state
                    print(f"{name:13} FAILED {key}: {e!r}")
                    _record(name, key, repr(e)[:1000])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", action="store_true")
    ap.add_argument("--only", default=",".join(CONNECTORS))
    ap.add_argument("--every", type=int, default=0, help="re-run every N seconds")
    args = ap.parse_args()
    stores.ensure(DIM)
    while True:
        run_fixtures() if args.fixtures else run_live(args.only.split(","))
        if not args.every:
            break
        time.sleep(args.every)


if __name__ == "__main__":
    main()
