import os
from urllib.parse import urlparse

POSTGRES_DSN = os.environ.get("POSTGRES_DSN", "postgresql://devsearch:devsearch@localhost:5432/devsearch")
OPENSEARCH_URL = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
VOYAGE_API_KEY = os.environ.get("VOYAGE_API_KEY", "")
DAILY_ANSWER_CAP = int(os.environ.get("DAILY_ANSWER_CAP", "50"))
# Shared secret the web app sends as a Bearer token. Unset = API open (local dev only).
API_TOKEN = os.environ.get("API_TOKEN", "")
# Per-client-IP request limits (fixed windows in Redis).
RATE_LIMIT_PER_MIN = int(os.environ.get("RATE_LIMIT_PER_MIN", "60"))
ANSWER_LIMIT_PER_MIN = int(os.environ.get("ANSWER_LIMIT_PER_MIN", "6"))
LOGIN_LIMIT_PER_15MIN = int(os.environ.get("LOGIN_LIMIT_PER_15MIN", "10"))


def _list(env: str, default: str) -> list[str]:
    return [m.strip() for m in os.environ.get(env, default).split(",") if m.strip()]


# provider: (OpenAI-compatible base URL, API key env var, default models).
# shortcut: non-Claude defaults are best-effort IDs as of 2026-11; override with <PROVIDER>_MODELS when a provider renames.
OPENAI_COMPATIBLE = {
    "openai": ("https://api.openai.com/v1", "OPENAI_API_KEY", "gpt-6-astra,gpt-6.1-sol,gpt-6.1-terra,gpt-6-luna"),
    "google": ("https://generativelanguage.googleapis.com/v1beta/openai", "GEMINI_API_KEY", "gemini-3.8-flash,gemini-3.1-pro-preview"),
    "xai": ("https://api.x.ai/v1", "XAI_API_KEY", "grok-4.7"),
    "mistral": ("https://api.mistral.ai/v1", "MISTRAL_API_KEY", "mistral-large-latest,mistral-medium-latest,mistral-small-latest"),
    "deepseek": ("https://api.deepseek.com/v1", "DEEPSEEK_API_KEY", "deepseek-v4-pro,deepseek-v4-flash"),
    "openrouter": ("https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", ""),
    # Any OpenAI-compatible server (vLLM, Ollama, LiteLLM, Azure...). Set by the operator only, never by users (SSRF).
    "custom": (os.environ.get("CUSTOM_OPENAI_BASE_URL", "").rstrip("/"), "CUSTOM_OPENAI_API_KEY", ""),
}


def _models() -> dict[str, tuple[str | None, str]]:
    """Offered models as "provider:model" -> (base_url, server api_key or ""). Anthropic's base_url is None (SDK).
    Every known provider is listed: visitors bring their own key; a server key is only a fallback."""
    claude_key = os.environ.get("ANTHROPIC_API_KEY", "")
    out = {f"anthropic:{m}": (None, claude_key) for m in
           _list("ANTHROPIC_MODELS", "claude-opus-5-5,claude-fable-5-2,claude-sonnet-5-5,claude-haiku-5-5")}
    for name, (base, key_env, default) in OPENAI_COMPATIBLE.items():
        key = os.environ.get(key_env, "")
        if name == "custom":
            if not base:
                continue
            u = urlparse(base)
            if u.scheme not in ("http", "https") or not u.hostname:
                raise ValueError("CUSTOM_OPENAI_BASE_URL must be an http(s) URL")
        out |= {f"{name}:{m}": (base, key) for m in _list(f"{name.upper()}_MODELS", default)}
    return out


MODELS = _models()
DEFAULT_MODEL = os.environ.get("DEFAULT_MODEL", "anthropic:claude-opus-5-5")
if MODELS and DEFAULT_MODEL not in MODELS:
    DEFAULT_MODEL = next(iter(MODELS))
