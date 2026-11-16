import json
from pathlib import Path

from workers.connectors import docs, github, stackoverflow
from workers.document import html_to_markdown
from workers.pipeline.chunk_embed_index import chunk

FIX = json.loads((Path(__file__).parents[1] / "fixtures" / "fixtures.json").read_text())


def test_html_to_markdown_keeps_headings_and_code_drops_chrome():
    title, md = html_to_markdown(FIX["docs"][0]["html"])
    assert title == "useEffect (React 19)"
    assert "# useEffect" in md and "## Cleanup" in md
    assert "```js\nuseEffect(() => {" in md
    assert "Menu" not in md and "Footer" not in md


def test_wrapper_divs_inside_code_add_no_blank_lines():
    _, md = html_to_markdown('<pre><code class="language-js"><div>a();\n</div><div>b();</div></code></pre>')
    assert md == "```js\na();\nb();\n```"


def test_chunk_splits_by_heading_with_path():
    md = "# A\n\nintro\n\n## B\n\nbody b\n\n```py\nx = 1\n```\n\n## C\n\nbody c"
    assert chunk(md) == ["A\n\nintro", "A > B\n\nbody b\n\n```py\nx = 1\n```", "A > C\n\nbody c"]


def test_chunk_respects_max_size():
    md = "# H\n\n" + "\n\n".join(f"paragraph {i} " + "x" * 80 for i in range(40))
    pieces = chunk(md, max_chars=500)
    assert len(pieces) > 1
    assert all(len(p) <= 500 + len("H\n\n") for p in pieces)
    assert all(p.startswith("H\n\n") for p in pieces)


def test_code_fence_stays_whole():
    md = "text\n\n```\nline1\n\nline2\n```"
    assert chunk(md) == ["text\n\n```\nline1\n\nline2\n```"]


def test_connectors_emit_same_document_shape():
    f = FIX
    d = docs.parse(f["docs"][0]["url"], f["docs"][0]["html"], f["docs"][0]["seed"])
    g = github.parse(f["github"][0]["repo"], f["github"][0]["readme"], f["github"][0]["release"], {**f["github"][0]["seed"], "version": None})
    s = stackoverflow.parse(f["stackoverflow"][0]["question"], f["stackoverflow"][0]["answers"], f["stackoverflow"][0]["seed"])
    assert (d.source, d.version, d.reliability) == ("docs", "19", 1.0)
    assert (g.source, g.version) == ("github", "0.115.0")  # falls back to the release tag
    assert (s.source, s.version) == ("stackoverflow", "any")
    assert "## Accepted answer (score 80, by sample_answerer)" in s.text
    assert "CC BY-SA" in s.text
    assert s.updated_at.startswith("2025-10-09")


def test_markdown_pages_keep_their_structure():
    src = '---\ntitle: middleware.js\ndescription: x\n---\n\n# middleware.js\n\nIntro.\n\n## Matcher\n\nUse `matcher`.\n'
    d = docs.parse("https://nextjs.org/docs/x", src, {"language": "javascript", "framework": "next.js"}, markdown=True)
    assert d.title == "middleware.js"
    assert not d.text.startswith("---") and "description:" not in d.text
    assert len(chunk(d.text)) == 2
