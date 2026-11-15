"""Chunk a Document by heading and code block, embed the chunks, write them to all stores."""
import hashlib
import re
from dataclasses import asdict

from api.app import stores
from api.app.embed import embed
from workers.document import Document

MAX_CHARS = 1500


def _blocks(md: str):
    """Yields headings, paragraphs, and whole fenced code blocks."""
    buf: list[str] = []
    in_fence = False
    for line in md.splitlines():
        is_fence = line.strip().startswith("```")
        if in_fence:
            buf.append(line)
            if is_fence:
                yield "\n".join(buf)
                buf, in_fence = [], False
            continue
        if is_fence or re.match(r"#{1,6} ", line) or not line.strip():
            if buf:
                yield "\n".join(buf)
            buf = []
            if is_fence:
                buf, in_fence = [line], True
            elif line.strip():
                yield line
            continue
        buf.append(line)
    if buf:
        yield "\n".join(buf)


def _split(block: str, max_chars: int) -> list[str]:
    # shortcut: an oversized code block is cut on line boundaries, so its fence can be split across chunks.
    pieces, cur = [], ""
    for line in block.splitlines(keepends=True):
        if cur and len(cur) + len(line) > max_chars:
            pieces.append(cur)
            cur = ""
        cur += line
    return pieces + [cur] if cur else pieces


def chunk(md: str, max_chars: int = MAX_CHARS) -> list[str]:
    """Each heading starts a new chunk; each chunk is prefixed with its heading path."""
    chunks: list[str] = []
    buf: list[str] = []
    path: list[str] = []

    def flush():
        body = "\n\n".join(buf).strip()
        if body:
            chunks.append((" > ".join(path) + "\n\n" if path else "") + body)
        buf.clear()

    for block in _blocks(md):
        if m := re.match(r"(#{1,6}) (.*)", block):
            flush()
            path[len(m[1]) - 1 :] = [m[2].strip()]
            continue
        for piece in _split(block, max_chars) if len(block) > max_chars else [block]:
            if buf and sum(len(b) + 2 for b in buf) + len(piece) > max_chars:
                flush()
            buf.append(piece)
    flush()
    return chunks


def index(doc: Document) -> int:
    pieces = chunk(doc.text)
    meta = asdict(doc)
    del meta["text"]
    chunks = [{**meta, "chunk_id": hashlib.sha1(f"{doc.url}#{i}".encode()).hexdigest(), "text": p}
              for i, p in enumerate(pieces)]
    vectors = embed([f"{doc.title}\n{p}" for p in pieces], "document") if pieces else []
    stores.replace_chunks(doc.url, chunks, vectors)
    with stores.pg() as c:  # written last, so a documents row means the chunks are indexed
        c.execute("insert into sources values (%s, %s) on conflict (name) do update set reliability = excluded.reliability",
                  (doc.source, doc.reliability))
        c.execute(
            """insert into documents (url, source, title, language, framework, version, fetched_at, updated_at, reliability, chunk_count)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               on conflict (url) do update set source = excluded.source, title = excluded.title,
                 language = excluded.language, framework = excluded.framework, version = excluded.version,
                 fetched_at = excluded.fetched_at, updated_at = excluded.updated_at,
                 reliability = excluded.reliability, chunk_count = excluded.chunk_count""",
            (doc.url, doc.source, doc.title, doc.language, doc.framework, doc.version,
             doc.fetched_at, doc.updated_at, doc.reliability, len(chunks)),
        )
    return len(chunks)
