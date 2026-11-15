from datetime import datetime, timezone

from api.app.search import hybrid


def test_rrf_rewards_agreement_between_rankings():
    fused = hybrid.rrf(["a", "b", "c"], ["c", "a", "d"])
    order = sorted(fused, key=fused.get, reverse=True)
    assert order[0] == "a"  # rank 1 + rank 2 beats c (rank 3 + rank 1)
    assert set(order) == {"a", "b", "c", "d"}
    assert fused["a"] == 1 / 61 + 1 / 62


def test_rrf_empty():
    assert hybrid.rrf([], []) == {}


def test_version_filter_includes_unversioned_docs():
    assert hybrid.os_filter("react", "18") == [
        {"term": {"framework": "react"}},
        {"terms": {"version": ["18", "any"]}},
    ]
    assert hybrid.qdrant_filter("react", "18") == {"must": [
        {"key": "framework", "match": {"value": "react"}},
        {"key": "version", "match": {"any": ["18", "any"]}},
    ]}


def test_no_filters():
    assert hybrid.os_filter(None, None) == []
    assert hybrid.qdrant_filter(None, None) is None
    assert hybrid.qdrant_filter(None, "19") == {"must": [{"key": "version", "match": {"any": ["19", "any"]}}]}


def test_rerank_prefers_reliable_and_fresh():
    now = datetime(2026, 11, 15, tzinfo=timezone.utc)
    chunks = {
        "so": {"reliability": 0.7, "updated_at": "2026-11-01T00:00:00+00:00"},
        "docs": {"reliability": 1.0, "updated_at": "2026-11-01T00:00:00+00:00"},
        "old_docs": {"reliability": 1.0, "updated_at": "2020-01-01T00:00:00+00:00"},
    }
    ranked = hybrid.rerank({"so": 0.02, "docs": 0.02, "old_docs": 0.02, "missing": 1.0}, chunks, now)
    assert [cid for cid, _ in ranked] == ["docs", "so", "old_docs"]  # "missing" has no hydrated chunk


def test_freshness_bounds():
    now = datetime(2026, 11, 15, tzinfo=timezone.utc)
    assert hybrid.freshness(now.isoformat(), now) == 1.0
    assert 0.5 < hybrid.freshness("2000-01-01T00:00:00+00:00", now) < 0.51
    assert hybrid.freshness(None, now) == 0.75
