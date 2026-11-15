import pytest
from fastapi.testclient import TestClient

from api.app import config, main, stores
from api.app.answer import grounding
from api.app.search import hybrid

CHUNK = {"chunk_id": "c1", "url": "https://x/1", "title": "useEffect", "source": "docs",
         "framework": "react", "version": "19", "text": "Return a cleanup function.", "updated_at": None}


class FakeRedis:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def setex(self, k, _ttl, v):
        self.d[k] = v

    def incr(self, k):
        self.d[k] = str(int(self.d.get(k, 0)) + 1)
        return int(self.d[k])

    def expire(self, *_):
        pass


@pytest.fixture
def env(monkeypatch):
    calls = {"search": [], "ask": []}
    results = {"chunks": [CHUNK], "text": "Return a cleanup function [1]."}

    def fake_search(q, framework=None, version=None, k=10):
        calls["search"].append((q, framework, version))
        return results["chunks"]

    def fake_ask(model, messages, user_key=None):
        calls.setdefault("key", []).append(user_key)
        calls["ask"].append(messages)
        calls.setdefault("model", []).append(model)
        return results["text"], False

    monkeypatch.setattr(stores, "rds", lambda r=FakeRedis(): r)
    monkeypatch.setattr(hybrid, "search", fake_search)
    monkeypatch.setattr(grounding, "ask", fake_ask)
    return TestClient(main.app), calls, results


def test_search_is_cached(env):
    client, calls, _ = env
    for _ in range(2):
        r = client.get("/search", params={"q": "useEffect cleanup", "framework": "react", "version": "19"})
        assert r.status_code == 200
        assert r.json()["results"][0]["chunk_id"] == "c1"
    assert calls["search"] == [("useEffect cleanup", "react", "19")]


def test_search_validates_query(env):
    client, _, _ = env
    assert client.get("/search", params={"q": ""}).status_code == 422


def test_answer_with_citation(env):
    client, _, _ = env
    body = client.post("/answer", json={"q": "how do I clean up an effect?"}).json()
    assert body["found"] is True
    assert body["citations"][0]["url"] == "https://x/1"
    assert body["conversation_id"]


def test_answer_not_found_when_nothing_retrieved(env):
    client, calls, results = env
    results["chunks"] = []
    body = client.post("/answer", json={"q": "unknown thing"}).json()
    assert body == {"conversation_id": body["conversation_id"], "model": config.DEFAULT_MODEL,
                    "found": False, "answer": None, "citations": []}
    assert calls["ask"] == []  # no model call without sources


def test_answer_not_found_from_model(env):
    client, _, results = env
    results["text"] = "NOT_FOUND"
    body = client.post("/answer", json={"q": "something the docs miss"}).json()
    assert body["found"] is False and body["answer"] is None


def test_follow_up_reuses_conversation(env):
    client, calls, _ = env
    first = client.post("/answer", json={"q": "useEffect cleanup"}).json()
    client.post("/answer", json={"q": "and in strict mode?", "conversation_id": first["conversation_id"]})
    assert calls["search"][1][0] == "useEffect cleanup and in strict mode?"
    roles = [m["role"] for m in calls["ask"][1]]
    assert roles == ["user", "assistant", "user"]


def test_daily_cap(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setattr(config, "DAILY_ANSWER_CAP", 1)
    assert client.post("/answer", json={"q": "one"}).status_code == 200
    assert client.post("/answer", json={"q": "two"}).status_code == 429


def test_unknown_model_rejected(env):
    client, calls, _ = env
    assert client.post("/answer", json={"q": "x", "model": "evil:gpt"}).status_code == 400
    assert calls["ask"] == []


def test_models_lists_default(env):
    client, _, _ = env
    body = client.get("/models").json()
    assert body["default"] in [m["id"] for m in body["models"]]


def test_api_token_required_when_set(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setattr(config, "API_TOKEN", "s3cret")
    assert client.get("/models").status_code == 401
    assert client.get("/models", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/models", headers={"Authorization": "Bearer s3cret"}).status_code == 200


def test_cap_uses_forwarded_ip_only_with_token(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setattr(config, "DAILY_ANSWER_CAP", 1)
    monkeypatch.setattr(config, "API_TOKEN", "t")
    h = {"Authorization": "Bearer t"}
    assert client.post("/answer", json={"q": "a"}, headers={**h, "x-client-ip": "1.1.1.1"}).status_code == 200
    assert client.post("/answer", json={"q": "b"}, headers={**h, "x-client-ip": "2.2.2.2"}).status_code == 200
    assert client.post("/answer", json={"q": "c"}, headers={**h, "x-client-ip": "1.1.1.1"}).status_code == 429


def test_rate_limit_per_ip(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setattr(config, "RATE_LIMIT_PER_MIN", 2)
    assert client.get("/models").status_code == 200
    assert client.get("/models").status_code == 200
    r = client.get("/models")
    assert r.status_code == 429 and 1 <= int(r.headers["retry-after"]) <= 60


def test_answer_limit(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setattr(config, "ANSWER_LIMIT_PER_MIN", 1)
    assert client.post("/answer", json={"q": "one"}).status_code == 200
    assert client.post("/answer", json={"q": "two"}).status_code == 429


def test_login_attempt_limit(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setattr(config, "LOGIN_LIMIT_PER_15MIN", 2)
    assert [client.post("/login-attempt").status_code for _ in range(3)] == [204, 204, 429]


def test_byok_key_is_passed_and_required(env, monkeypatch):
    client, calls, _ = env
    monkeypatch.setitem(config.MODELS, "openai:gpt-x", ("https://api.openai.com/v1", ""))
    r = client.post("/answer", json={"q": "x", "model": "openai:gpt-x"})
    assert r.status_code == 400 and "API key" in r.json()["detail"]
    assert calls["search"] == [] and calls["ask"] == []  # rejected before retrieval or a model call
    ok = client.post("/answer", json={"q": "x", "model": "openai:gpt-x", "api_key": "sk-user-123456"})
    assert ok.status_code == 200 and calls["key"] == ["sk-user-123456"]
    assert "sk-user" not in ok.text  # never echoed back


def test_models_marks_server_keys(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setitem(config.MODELS, "openai:gpt-x", ("https://api.openai.com/v1", ""))
    monkeypatch.setitem(config.MODELS, "xai:grok-y", ("https://api.x.ai/v1", "server-key"))
    by_id = {m["id"]: m for m in client.get("/models").json()["models"]}
    assert by_id["openai:gpt-x"]["server_key"] is False and by_id["xai:grok-y"]["server_key"] is True
