import httpx
import pytest

from api.app import config, llm


class Resp:
    def __init__(self, status, body):
        self.status_code, self._b = status, body

    def json(self):
        return self._b


@pytest.fixture
def custom(monkeypatch):
    monkeypatch.setitem(config.MODELS, "custom:m", ("https://llm.example/v1", "k"))
    sent = {}

    def post(url, headers, json, timeout):
        sent.update(url=url, headers=headers, json=json)
        return sent["resp"]

    monkeypatch.setattr(httpx, "post", post)
    return sent


def test_openai_compatible_request_and_reply(custom):
    custom["resp"] = Resp(200, {"choices": [{"finish_reason": "stop", "message": {"content": "hi [1]"}}]})
    assert llm.complete("custom:m", "SYS", [{"role": "user", "content": "q"}]) == ("hi [1]", False)
    assert custom["url"] == "https://llm.example/v1/chat/completions"
    assert custom["headers"] == {"Authorization": "Bearer k"}
    assert custom["json"]["messages"][0] == {"role": "system", "content": "SYS"}


def test_content_filter_is_refusal(custom):
    custom["resp"] = Resp(200, {"choices": [{"finish_reason": "content_filter", "message": {"content": None}}]})
    assert llm.complete("custom:m", "S", []) == ("", True)


def test_upstream_error_hides_body(custom):
    custom["resp"] = Resp(500, {"error": "boom sk-123"})
    with pytest.raises(llm.ModelError, match="^Answer model error: 500$"):
        llm.complete("custom:m", "S", [])


def test_malformed_reply_is_model_error(custom):
    custom["resp"] = Resp(200, {"choices": []})
    with pytest.raises(llm.ModelError):
        llm.complete("custom:m", "S", [])


def test_user_key_wins_and_rejection_is_clear(custom, monkeypatch):
    custom["resp"] = Resp(401, {"error": "invalid"})
    with pytest.raises(llm.ModelError, match="rejected"):
        llm.complete("custom:m", "S", [], "user-key-123")
    assert custom["headers"] == {"Authorization": "Bearer user-key-123"}


def test_missing_key_raises_before_any_call(monkeypatch):
    monkeypatch.setitem(config.MODELS, "openai:gpt-x", ("https://api.openai.com/v1", ""))
    monkeypatch.setattr(httpx, "post", lambda *a, **k: pytest.fail("no call without a key"))
    with pytest.raises(llm.MissingKey):
        llm.complete("openai:gpt-x", "S", [])
