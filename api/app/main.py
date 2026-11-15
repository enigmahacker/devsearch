import hashlib
import hmac
import json
import time
import uuid
from contextlib import asynccontextmanager
from datetime import date

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field

from api.app import config, llm, stores
from api.app.answer import grounding
from api.app.embed import DIM
from api.app.search import hybrid

SEARCH_TTL = 300
CONV_TTL = 3600
MAX_TURNS = 5


@asynccontextmanager
async def lifespan(_app):
    stores.ensure(DIM)
    yield


def require_token(request: Request):
    if not config.API_TOKEN:
        return
    sent = request.headers.get("authorization", "").removeprefix("Bearer ")
    if not hmac.compare_digest(sent.encode(), config.API_TOKEN.encode()):
        raise HTTPException(401, "Unauthorized")


def client_ip(request: Request) -> str:
    # Behind the web proxy every request comes from one host; trust its forwarded IP only when the token proved it is ours.
    if config.API_TOKEN and (ip := request.headers.get("x-client-ip")):
        return ip[:64]
    return request.client.host if request.client else "unknown"


def limit(request: Request, bucket: str, max_calls: int, window: int) -> None:
    """Fixed-window limit per client IP; raises 429 with Retry-After once over max_calls."""
    r = stores.rds()
    slot = int(time.time() // window)
    key = f"rl:{bucket}:{client_ip(request)}:{slot}"
    n = r.incr(key)
    if n == 1:
        r.expire(key, window)
    if n > max_calls:
        retry = str(window - int(time.time()) % window)
        raise HTTPException(429, "Too many requests, slow down", headers={"Retry-After": retry})


def rate_limit(request: Request):
    limit(request, "all", config.RATE_LIMIT_PER_MIN, 60)


_open_docs = not config.API_TOKEN
# require_token runs first, so a caller without the token can't burn other clients' limits.
app = FastAPI(title="DevSearch API", lifespan=lifespan, dependencies=[Depends(require_token), Depends(rate_limit)],
              docs_url="/docs" if _open_docs else None, redoc_url=None,
              openapi_url="/openapi.json" if _open_docs else None)


@app.get("/search")
def search(q: str = Query(min_length=1, max_length=500), framework: str | None = None,
           version: str | None = None, k: int = Query(10, ge=1, le=50)):
    key = "search:" + hashlib.sha1(json.dumps([q, framework, version, k]).encode()).hexdigest()
    if cached := stores.rds().get(key):
        return json.loads(cached)
    out = {"results": hybrid.search(q, framework, version, k)}
    stores.rds().setex(key, SEARCH_TTL, json.dumps(out, default=str))
    return out


@app.get("/filters")
def filters():
    with stores.pg() as c:
        rows = c.execute(
            "select framework, array_agg(distinct version order by version) from documents group by framework order by framework"
        ).fetchall()
    return {"frameworks": [{"name": f, "versions": [v for v in vs if v != hybrid.UNVERSIONED]} for f, vs in rows]}


@app.get("/models")
def models():
    return {"default": config.DEFAULT_MODEL,
            "models": [{"id": k, "provider": k.split(":", 1)[0], "name": k.split(":", 1)[1],
                        "server_key": bool(config.MODELS[k][1])} for k in config.MODELS]}


class AnswerRequest(BaseModel):
    q: str = Field(min_length=1, max_length=500)
    framework: str | None = None
    version: str | None = None
    conversation_id: str | None = Field(None, max_length=64)
    model: str | None = Field(None, max_length=200)
    # The visitor's own provider key: used for this call only, never stored, logged or echoed.
    api_key: str | None = Field(None, min_length=8, max_length=512, repr=False)


@app.post("/login-attempt", status_code=204)
def login_attempt(request: Request):
    """Called by the web app before checking a password, to cap guessing per IP."""
    limit(request, "login", config.LOGIN_LIMIT_PER_15MIN, 900)


@app.post("/answer")
def answer(req: AnswerRequest, request: Request):
    limit(request, "answer", config.ANSWER_LIMIT_PER_MIN, 60)
    model = req.model or config.DEFAULT_MODEL
    if model not in config.MODELS:
        raise HTTPException(400, "Unknown or disabled model")
    if llm.needs_key(model, req.api_key):  # before retrieval, so a missing key costs nothing
        raise HTTPException(400, f"Add your {model.split(':', 1)[0]} API key in Settings")
    r = stores.rds()
    conv_id = req.conversation_id or uuid.uuid4().hex
    history = json.loads(r.get(f"conv:{conv_id}") or "[]")
    # follow-ups like "and in v18?" need the previous question to retrieve anything useful
    retrieval_q = f"{history[-1]['q']} {req.q}" if history else req.q
    chunks = hybrid.search(retrieval_q, req.framework, req.version, k=8)

    result = {"found": False, "answer": None, "citations": []}
    if chunks:
        cap_key = f"cap:{client_ip(request)}:{date.today()}"
        if r.incr(cap_key) == 1:
            r.expire(cap_key, 86400)
        if int(r.get(cap_key)) > config.DAILY_ANSWER_CAP:
            raise HTTPException(429, "Daily answer limit reached")
        try:
            text, refused = grounding.ask(model, grounding.build_messages(
                req.q, chunks, history, req.framework, req.version), req.api_key)
        except llm.ModelError as e:
            raise HTTPException(502, str(e)) from e
        if not refused:
            result = grounding.map_citations(text, chunks)

    history = (history + [{"q": req.q, "a": result["answer"] or grounding.NOT_FOUND}])[-MAX_TURNS:]
    r.setex(f"conv:{conv_id}", CONV_TTL, json.dumps(history))
    return {"conversation_id": conv_id, "model": model, **result}
