"""Thin clients for Postgres, OpenSearch (REST), Qdrant (REST) and Redis."""
import json
import uuid

import httpx
import psycopg
import redis

from api.app import config

INDEX = "chunks"
COLLECTION = "chunks"

SCHEMA = """
create table if not exists sources (name text primary key, reliability real not null);
create table if not exists documents (
  url text primary key,
  source text not null references sources(name),
  title text, language text, framework text, version text,
  fetched_at timestamptz, updated_at timestamptz, reliability real, chunk_count int
);
create table if not exists crawl_state (
  connector text, key text, last_fetched timestamptz, error text,
  primary key (connector, key)
);
-- Supabase exposes the public schema through its Data API; RLS with no policies keeps these tables server-only.
alter table sources enable row level security;
alter table documents enable row level security;
alter table crawl_state enable row level security;
"""

os_http = httpx.Client(base_url=config.OPENSEARCH_URL, timeout=30)
qd_http = httpx.Client(base_url=config.QDRANT_URL, timeout=30,
                       headers={"api-key": config.QDRANT_API_KEY} if config.QDRANT_API_KEY else {})
_redis = None


def pg():
    # prepare_threshold=None: Supabase's transaction pooler (port 6543) can't hold server-side prepared statements.
    return psycopg.connect(config.POSTGRES_DSN, autocommit=True, prepare_threshold=None)


def rds():
    global _redis
    _redis = _redis or redis.Redis.from_url(config.REDIS_URL, decode_responses=True)
    return _redis


def point_id(chunk_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_id))


def ensure(dim: int) -> None:
    with pg() as c:
        c.execute(SCHEMA)
    if os_http.head(f"/{INDEX}").status_code == 404:
        kw = {"type": "keyword"}
        os_http.put(f"/{INDEX}", json={"mappings": {"properties": {
            "text": {"type": "text"}, "title": {"type": "text"},
            "url": kw, "source": kw, "framework": kw, "version": kw, "language": kw,
            "fetched_at": {"type": "date"}, "updated_at": {"type": "date"},
            "reliability": {"type": "float"},
        }}}).raise_for_status()
    if qd_http.get(f"/collections/{COLLECTION}").status_code == 404:
        qd_http.put(f"/collections/{COLLECTION}", json={"vectors": {"size": dim, "distance": "Cosine"}}).raise_for_status()
        for field in ("framework", "version", "url"):
            qd_http.put(f"/collections/{COLLECTION}/index", json={"field_name": field, "field_schema": "keyword"}).raise_for_status()


def replace_chunks(url: str, chunks: list[dict], vectors: list[list[float]]) -> None:
    """Drop a URL's old chunks from both indexes, then write the new ones."""
    os_http.post(f"/{INDEX}/_delete_by_query?refresh=true", json={"query": {"term": {"url": url}}}).raise_for_status()
    qd_http.post(f"/collections/{COLLECTION}/points/delete?wait=true",
                 json={"filter": {"must": [{"key": "url", "match": {"value": url}}]}}).raise_for_status()
    if not chunks:
        return
    lines = []
    for ch in chunks:
        lines += [json.dumps({"index": {"_id": ch["chunk_id"]}}), json.dumps(ch, default=str)]
    r = os_http.post(f"/{INDEX}/_bulk?refresh=true", content="\n".join(lines) + "\n",
                     headers={"Content-Type": "application/x-ndjson"})
    r.raise_for_status()
    if r.json().get("errors"):
        raise RuntimeError(f"OpenSearch bulk errors for {url}")
    points = [{"id": point_id(ch["chunk_id"]), "vector": v,
               "payload": {k: ch[k] for k in ("chunk_id", "url", "framework", "version")}}
              for ch, v in zip(chunks, vectors)]
    qd_http.put(f"/collections/{COLLECTION}/points?wait=true", json={"points": points}).raise_for_status()


def bm25(query: str, filters: list[dict], size: int) -> list[str]:
    body = {"size": size, "_source": False, "query": {"bool": {
        "must": {"multi_match": {"query": query, "fields": ["title^2", "text"]}},
        "filter": filters,
    }}}
    r = os_http.post(f"/{INDEX}/_search", json=body)
    r.raise_for_status()
    return [h["_id"] for h in r.json()["hits"]["hits"]]


def knn(vector: list[float], qfilter: dict | None, limit: int) -> list[str]:
    body = {"query": vector, "limit": limit, "with_payload": ["chunk_id"]}
    if qfilter:
        body["filter"] = qfilter
    r = qd_http.post(f"/collections/{COLLECTION}/points/query", json=body)
    r.raise_for_status()
    return [p["payload"]["chunk_id"] for p in r.json()["result"]["points"]]


def get_chunks(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    r = os_http.post(f"/{INDEX}/_mget", json={"ids": ids})
    r.raise_for_status()
    return {d["_id"]: d["_source"] for d in r.json()["docs"] if d.get("found")}
