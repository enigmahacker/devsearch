"""Hybrid retrieval: BM25 (OpenSearch) + vector kNN (Qdrant), fused with RRF, re-ranked."""
from datetime import datetime, timezone

from api.app import stores
from api.app.embed import embed

RRF_K = 60
UNVERSIONED = "any"  # docs with no known version (most Stack Overflow posts) match every version filter


def os_filter(framework: str | None, version: str | None) -> list[dict]:
    f = []
    if framework:
        f.append({"term": {"framework": framework}})
    if version:
        f.append({"terms": {"version": [version, UNVERSIONED]}})
    return f


def qdrant_filter(framework: str | None, version: str | None) -> dict | None:
    must = []
    if framework:
        must.append({"key": "framework", "match": {"value": framework}})
    if version:
        must.append({"key": "version", "match": {"any": [version, UNVERSIONED]}})
    return {"must": must} if must else None


def rrf(*rankings: list[str], k: int = RRF_K) -> dict[str, float]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return scores


def freshness(updated_at: str | None, now: datetime) -> float:
    """1.0 for today, decays toward 0.5 with a one-year half-life."""
    if not updated_at:
        return 0.75
    age_days = max((now - datetime.fromisoformat(updated_at)).days, 0)
    return 0.5 + 0.5 * 0.5 ** (age_days / 365)


def rerank(fused: dict[str, float], chunks: dict[str, dict], now: datetime) -> list[tuple[str, float]]:
    scored = [
        (cid, s * chunks[cid].get("reliability", 0.5) * freshness(chunks[cid].get("updated_at"), now))
        for cid, s in fused.items() if cid in chunks
    ]
    return sorted(scored, key=lambda x: x[1], reverse=True)


def search(q: str, framework: str | None = None, version: str | None = None, k: int = 10) -> list[dict]:
    bm25_ids = stores.bm25(q, os_filter(framework, version), size=50)
    knn_ids = stores.knn(embed([q], "query")[0], qdrant_filter(framework, version), limit=50)
    fused = rrf(bm25_ids, knn_ids)
    candidates = sorted(fused, key=fused.get, reverse=True)[: k * 3]
    chunks = stores.get_chunks(candidates)
    ranked = rerank({c: fused[c] for c in candidates}, chunks, datetime.now(timezone.utc))
    return [{**chunks[cid], "score": round(score, 6)} for cid, score in ranked[:k]]
