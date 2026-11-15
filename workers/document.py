"""The normalized Document every connector emits, plus HTML -> markdown for HTML sources."""
import re
from dataclasses import dataclass
from html.parser import HTMLParser

RELIABILITY = {"docs": 1.0, "github": 0.8, "stackoverflow": 0.7}


@dataclass
class Document:
    source: str  # docs | github | stackoverflow
    url: str
    title: str
    text: str  # markdown
    language: str
    framework: str
    version: str  # "any" when unknown
    fetched_at: str  # ISO 8601, when we crawled it
    updated_at: str | None  # ISO 8601, when the source last changed it (drives freshness)
    reliability: float


class _Markdown(HTMLParser):
    SKIP = {"script", "style", "nav", "footer", "header", "aside", "noscript", "svg", "form", "button"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.title = ""
        self.skip = 0
        self.pre = 0
        self.fence_at = -1
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        if self.skip:
            return
        cls = dict(attrs).get("class") or ""
        if tag == "title":
            self.in_title = True
        elif re.fullmatch(r"h[1-4]", tag):
            self.out.append("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "pre":
            self.pre += 1
            self.fence_at = len(self.out)
            self.out.append("\n\n```\n")
        elif tag == "code" and self.pre:
            if m := re.search(r"(?:language|lang)-([\w+-]+)", cls):
                self.out[self.fence_at] = f"\n\n```{m[1]}\n"
        elif tag == "code":
            self.out.append("`")
        elif self.pre:  # inside code only real line breaks count, not wrapper divs
            if tag == "br":
                self.out.append("\n")
        elif tag == "li":
            self.out.append("\n- ")
        elif tag in ("p", "div", "br", "tr", "section", "article", "blockquote", "table"):
            self.out.append("\n\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip = max(self.skip - 1, 0)
            return
        if self.skip:
            return
        if tag == "title":
            self.in_title = False
        elif re.fullmatch(r"h[1-4]", tag):
            self.out.append("\n\n")
        elif tag == "pre" and self.pre:
            self.pre -= 1
            self.out.append("\n```\n\n")
        elif tag == "code" and not self.pre:
            self.out.append("`")

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif self.skip:
            return
        elif self.pre:
            self.out.append(data)
        else:
            self.out.append(re.sub(r"\s+", " ", data))


def html_to_markdown(html: str) -> tuple[str, str]:
    """Returns (title, markdown)."""
    p = _Markdown()
    p.feed(html)
    md = re.sub(r"[ \t]+\n", "\n", "".join(p.out))
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return p.title.strip(), md
