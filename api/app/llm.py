"""Answer models: Claude through the Anthropic SDK, every other provider through the OpenAI-compatible chat API."""
import anthropic
import httpx

from api.app import config


class ModelError(Exception):
    """Upstream model failure; the message is safe to show to users."""


_claude = None


def claude():
    global _claude
    _claude = _claude or anthropic.Anthropic()
    return _claude


class MissingKey(ModelError):
    """No visitor key and no server key for this provider."""


def needs_key(model_key: str, user_key: str | None) -> bool:
    """True when nobody can pay for this call. Anthropic falls back to the SDK's own credentials, custom servers may be keyless."""
    provider = model_key.split(":", 1)[0]
    return not user_key and not config.MODELS[model_key][1] and provider not in ("anthropic", "custom")


def complete(model_key: str, system: str, messages: list[dict], user_key: str | None = None) -> tuple[str, bool]:
    """Returns (text, refused). model_key must be a key of config.MODELS. user_key is the visitor's own key, used for
    this call only and never stored or logged; it wins over the server key."""
    base, server_key = config.MODELS[model_key]
    key = user_key or server_key
    provider, _, model = model_key.partition(":")
    if needs_key(model_key, user_key):
        raise MissingKey(f"Add your {provider} API key in Settings")
    if provider == "anthropic":
        return _anthropic(model, system, messages, key)
    try:
        r = httpx.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}"} if key else {},
            json={"model": model, "messages": [{"role": "system", "content": system}, *messages]},
            timeout=120,
        )
    except httpx.HTTPError as e:
        raise ModelError("Answer model unreachable") from e
    if r.status_code in (401, 403):
        raise ModelError("The API key was rejected by the provider")
    if r.status_code >= 400:
        raise ModelError(f"Answer model error: {r.status_code}")  # never echo the body: it can contain the key
    try:
        choice = r.json()["choices"][0]
        if choice.get("finish_reason") == "content_filter":
            return "", True
        return choice["message"].get("content") or "", False
    except (ValueError, KeyError, IndexError, TypeError, AttributeError) as e:
        raise ModelError("Answer model returned an unexpected response") from e


def _anthropic(model: str, system: str, messages: list[dict], key: str) -> tuple[str, bool]:
    # Haiku has no server-side refusal fallback; the other current Claude models take the "default" route.
    fallback = {} if model.startswith("claude-haiku") else {
        "betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    try:
        # A visitor's key gets its own short-lived client so it never lands in the shared one.
        client = anthropic.Anthropic(api_key=key) if key else claude()
        resp = client.beta.messages.create(
            model=model, max_tokens=16000, system=system, messages=messages,
            output_config={"effort": "medium"}, **fallback,
        )
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
        raise ModelError("The API key was rejected by the provider") from e
    except anthropic.APIStatusError as e:
        raise ModelError(f"Answer model error: {e.status_code}") from e
    except anthropic.APIConnectionError as e:
        raise ModelError("Answer model unreachable") from e
    if resp.stop_reason == "refusal":
        return "", True
    return "".join(b.text for b in resp.content if b.type == "text"), False
