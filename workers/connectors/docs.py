"""Official docs connector: fetches configured pages, honoring robots.txt."""
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from workers.document import RELIABILITY, Document, html_to_markdown

USER_AGENT = "DevSearchBot/0.1 (+local MVP crawler)"
_robots: dict[str, RobotFileParser] = {}


def parse(url: str, html: str, seed: dict, last_modified: str | None = None) -> Document:
    title, md = html_to_markdown(html)
    now = datetime.now(timezone.utc).isoformat()
    return Document(
        source="docs", url=url, title=title or url, text=md,
        language=seed["language"], framework=seed["framework"], version=seed.get("version", "any"),
        fetched_at=now, updated_at=last_modified or now, reliability=RELIABILITY["docs"],
    )


def _robots_for(url: str, client) -> RobotFileParser:
    host = "{0.scheme}://{0.netloc}".format(urlsplit(url))
    if host not in _robots:
        rp = RobotFileParser()
        r = client.get(f"{host}/robots.txt", headers={"User-Agent": USER_AGENT})
        rp.parse(r.text.splitlines() if r.status_code == 200 else [])  # no robots.txt = allowed
        _robots[host] = rp
    return _robots[host]


def fetch(seed: dict, client) -> list[Document]:
    # shortcut: crawls only the listed URLs, no link following; add sitemap.xml discovery for full sites.
    docs = []
    for url in seed["urls"]:
        rp = _robots_for(url, client)
        if not rp.can_fetch(USER_AGENT, url):
            print(f"  robots.txt disallows {url}, skipped")
            continue
        r = client.get(url, headers={"User-Agent": USER_AGENT}, follow_redirects=True)
        r.raise_for_status()
        lm = r.headers.get("last-modified")
        docs.append(parse(str(r.url), r.text, seed, lm and parsedate_to_datetime(lm).isoformat()))
        time.sleep(rp.crawl_delay(USER_AGENT) or 1)
    return docs
