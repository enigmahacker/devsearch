"""GitHub connector: a repo's README, versioned by its latest release."""
import os
from datetime import datetime, timezone

from workers.document import RELIABILITY, Document

API = "https://api.github.com"


def parse(repo: dict, readme: str, release: dict | None, seed: dict) -> Document:
    version = seed.get("version") or (release or {}).get("tag_name", "").lstrip("v") or "any"
    return Document(
        source="github", url=repo["html_url"], title=f"{repo['full_name']} README", text=readme,
        language=seed["language"], framework=seed["framework"], version=version,
        fetched_at=datetime.now(timezone.utc).isoformat(),
        updated_at=repo.get("pushed_at"), reliability=RELIABILITY["github"],
    )


def _get(client, path: str, accept: str = "application/vnd.github+json"):
    headers = {"Accept": accept, "X-GitHub-Api-Version": "2022-11-28"}
    if token := os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    r = client.get(API + path, headers=headers, follow_redirects=True)  # renamed/transferred repos 301
    if r.status_code in (403, 429) and r.headers.get("x-ratelimit-remaining") == "0":
        raise RuntimeError(f"GitHub rate limit hit; resets at {r.headers.get('x-ratelimit-reset')} (set GITHUB_TOKEN)")
    return r


def fetch(seed: dict, client) -> list[Document]:
    name = seed["repo"]
    repo = _get(client, f"/repos/{name}")
    repo.raise_for_status()
    readme = _get(client, f"/repos/{name}/readme", accept="application/vnd.github.raw+json")
    readme.raise_for_status()
    release = _get(client, f"/repos/{name}/releases/latest")
    return [parse(repo.json(), readme.text, release.json() if release.status_code == 200 else None, seed)]
