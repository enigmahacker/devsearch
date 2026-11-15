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

SEEDS = {
    "docs": [
        {"framework": "react", "language": "javascript", "version": "19",
         "urls": ["https://react.dev/reference/react/useEffect", "https://react.dev/reference/react/useState"]},
        {"framework": "react", "language": "javascript", "version": "18",
         "urls": ["https://legacy.reactjs.org/docs/hooks-effect.html", "https://legacy.reactjs.org/docs/hooks-state.html"]},
        {"framework": "fastapi", "language": "python", "version": "latest",
         "urls": ["https://fastapi.tiangolo.com/tutorial/dependencies/", "https://fastapi.tiangolo.com/tutorial/background-tasks/"]},
    ],
    "github": [
        {"repo": "facebook/react", "framework": "react", "language": "javascript", "version": "19"},
        {"repo": "fastapi/fastapi", "framework": "fastapi", "language": "python", "version": "latest"},
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
    with httpx.Client(timeout=30) as client:
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
