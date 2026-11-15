"""Stack Overflow connector: top-voted questions for a tag, with their top answers."""
import html
import os
import time
from datetime import datetime, timezone

from workers.document import RELIABILITY, Document, html_to_markdown

API = "https://api.stackexchange.com/2.3"


def parse(question: dict, answers: list[dict], seed: dict) -> Document:
    owner = question.get("owner", {}).get("display_name", "unknown")
    parts = [
        f"# {html.unescape(question['title'])}",
        f"_Question by {html.unescape(owner)}, score {question.get('score', 0)}. Content licensed CC BY-SA._",
        html_to_markdown(question.get("body", ""))[1],
    ]
    for a in sorted(answers, key=lambda a: (a.get("is_accepted", False), a.get("score", 0)), reverse=True)[:2]:
        label = "Accepted answer" if a.get("is_accepted") else "Answer"
        by = html.unescape(a.get("owner", {}).get("display_name", "unknown"))
        parts += [f"## {label} (score {a.get('score', 0)}, by {by})", html_to_markdown(a.get("body", ""))[1]]
    return Document(
        source="stackoverflow", url=question["link"], title=html.unescape(question["title"]),
        text="\n\n".join(parts), language=seed["language"], framework=seed["framework"],
        version=seed.get("version", "any"), fetched_at=datetime.now(timezone.utc).isoformat(),
        updated_at=datetime.fromtimestamp(question["last_activity_date"], timezone.utc).isoformat(),
        reliability=RELIABILITY["stackoverflow"],
    )


def _get(client, path: str, **params) -> dict:
    params |= {"site": "stackoverflow", "filter": "withbody"}
    if key := os.environ.get("STACK_KEY"):
        params["key"] = key
    r = client.get(API + path, params=params)
    r.raise_for_status()
    data = r.json()
    if backoff := data.get("backoff"):  # the API requires honoring this
        time.sleep(backoff)
    return data


def fetch(seed: dict, client) -> list[Document]:
    qs = _get(client, "/questions", tagged=seed["tag"], sort="votes", order="desc",
              pagesize=seed.get("limit", 10))["items"]
    if not qs:
        return []
    ids = ";".join(str(q["question_id"]) for q in qs)
    answers = _get(client, f"/questions/{ids}/answers", sort="votes", order="desc", pagesize=100)["items"]
    by_q: dict[int, list] = {}
    for a in answers:
        by_q.setdefault(a["question_id"], []).append(a)
    return [parse(q, by_q.get(q["question_id"], []), seed) for q in qs]
