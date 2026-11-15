import hashlib
import math
import re

import httpx

from api.app import config

# The Qdrant collection is created with this size; switching provider needs a re-index.
DIM = 1024 if config.VOYAGE_API_KEY else 384


def embed(texts: list[str], kind: str) -> list[list[float]]:
    """kind is "document" or "query" (Voyage embeds the two asymmetrically)."""
    if not config.VOYAGE_API_KEY:
        return [_hash_embed(t) for t in texts]
    out = []
    for i in range(0, len(texts), 64):
        r = httpx.post(
            "https://api.voyageai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {config.VOYAGE_API_KEY}"},
            json={"input": texts[i : i + 64], "model": "voyage-code-3", "input_type": kind},
            timeout=60,
        )
        r.raise_for_status()
        out += [d["embedding"] for d in r.json()["data"]]
    return out


def _hash_embed(text: str) -> list[float]:
    # shortcut: bag-of-words hashing, no real semantics; set VOYAGE_API_KEY for real vector recall.
    v = [0.0] * DIM
    for tok in re.findall(r"\w+", text.lower()):
        h = int.from_bytes(hashlib.blake2b(tok.encode(), digest_size=8).digest(), "big")
        v[h % DIM] += 1.0 if h & 1 << 63 else -1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]
