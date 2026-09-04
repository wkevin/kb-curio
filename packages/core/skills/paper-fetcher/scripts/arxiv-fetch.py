# -*- coding: utf-8 -*-
from __future__ import annotations

# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "httpx",
#     "beautifulsoup4",
#     "lxml",
#     "markdownify",
# ]
# ///

"""
arxiv Paper to Markdown — arXiv HTML / abs 页面抓取 & 结构化输出

与 wechat-fetch.py 同形态：
- httpx 直连 arxiv（无 WAF，不需要 Camoufox）
- BeautifulSoup 选择 arXiv HTML 的 LaTeXML 类（`.ltx_*`）
- 按段落切分正文，由调用 skill（agent 自身）做逐段中英对照翻译

入口: `python arxiv-fetch.py <url> [output_dir]`
stdout 输出 JSON：
{
    "success": bool,
    "metadata": { arxivId, title, authors[], abstract, pubDate, categories[], url },
    "sections": [ { heading, paragraphs: [str, ...] }, ... ],
    "figures": [ { index, src, caption } ],          # src 可能为 null（caption-only figure）
    "tables":  [ { index, caption, markdown } ],     # 渲染为 markdown 表格
    "markdown_path": str,
    "image_dir": str,
    "error": str | None,
}
"""

import asyncio
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
import markdownify
from bs4 import BeautifulSoup, NavigableString, Tag

PROXY = os.getenv("HTTP_PROXY") or os.getenv("HTTPS_PROXY")
IMAGE_CONCURRENCY = 5
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
ARXIV_HOSTS = ("arxiv.org", "www.arxiv.org", "export.arxiv.org")


# ============================================================
# URL parsing
# ============================================================


def normalize_arxiv_url(url: str) -> tuple[str, str]:
    """Return (arxiv_id, normalized_url).

    Accepts:
      - https://arxiv.org/html/<id>
      - https://arxiv.org/abs/<id>
      - https://arxiv.org/pdf/<id>
      - bare id like "2501.01234" or "2501.01234v2"

    Returns canonical abs URL (always available) plus the input form.
    """
    url = url.strip()
    if not url.startswith("http"):
        url = f"https://arxiv.org/abs/{url}"

    parsed = urlparse(url)
    if parsed.netloc not in ARXIV_HOSTS:
        raise ValueError(f"非 arxiv 域名: {parsed.netloc}")

    # /abs/<id>, /html/<id>, /pdf/<id>
    m = re.match(r"^/(?:abs|html|pdf)/([^/?#]+)", parsed.path)
    if not m:
        raise ValueError(f"无法从 URL 中提取 arxiv id: {url}")

    arxiv_id = m.group(1)
    canonical = f"https://arxiv.org/abs/{arxiv_id}"
    return arxiv_id, url


def html_url_for(arxiv_id: str) -> str:
    return f"https://arxiv.org/html/{arxiv_id}"


# ============================================================
# HTTP fetching
# ============================================================


async def fetch_html(client: httpx.AsyncClient, url: str) -> str:
    resp = await client.get(url, follow_redirects=True, timeout=30.0)
    resp.raise_for_status()
    return resp.text


# ============================================================
# Metadata extraction
# ============================================================


def _meta(soup: BeautifulSoup, name: str) -> str | None:
    tag = soup.find("meta", attrs={"name": name})
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


def extract_metadata(soup: BeautifulSoup, arxiv_id: str, source_url: str) -> dict:
    """Pull title / authors / abstract / pubDate / categories from arxiv DOM."""
    title = _meta(soup, "citation_title") or ""
    if not title:
        h1 = soup.select_one("h1.ltx_title")
        if h1:
            title = h1.get_text(" ", strip=True)

    # authors — citation_author may repeat
    authors: list[str] = []
    for m in soup.find_all("meta", attrs={"name": "citation_author"}):
        name = m.get("content", "").strip()
        if name and name not in authors:
            authors.append(name)
    if not authors:
        for span in soup.select(".ltx_personname"):
            txt = span.get_text(" ", strip=True)
            if txt and txt not in authors:
                authors.append(txt)

    # abstract — abs page uses <blockquote.abstract-math>, HTML uses .ltx_abstract
    abstract = ""
    abs_block = soup.select_one("blockquote.abstract") or soup.select_one(
        "blockquote.abstract-math"
    )
    if abs_block:
        # Strip leading "Abstract." label
        for span in abs_block.select(".abstract-header"):
            span.decompose()
        abstract = abs_block.get_text(" ", strip=True)
        abstract = re.sub(r"^Abstract\.?\s*", "", abstract, flags=re.IGNORECASE)
    if not abstract:
        ltx_abs = soup.select_one(".ltx_abstract")
        if ltx_abs:
            abstract = ltx_abs.get_text(" ", strip=True)

    # pubDate — citation_online_date first, citation_date fallback, no today cap
    pub_date = _meta(soup, "citation_online_date") or _meta(soup, "citation_date") or ""
    if pub_date:
        pub_date = re.sub(r"T.*$", "", pub_date)

    # categories — arxiv.categories is a single comma-separated string
    cats_raw = _meta(soup, "arxiv.categories") or ""
    categories = [c.strip() for c in cats_raw.split(",") if c.strip()]
    if not categories:
        primary = _meta(soup, "arxiv.primary_category") or ""
        if primary:
            # arxiv.primary_category value can be like "{name: cs.LG, group: cs}" — grab the trailing token
            m = re.search(r"([a-z\-]+\.[A-Z]{2,})", primary)
            if m:
                categories = [m.group(1)]

    return {
        "arxivId": arxiv_id,
        "title": title,
        "authors": authors,
        "abstract": abstract,
        "pubDate": pub_date,
        "categories": categories,
        "url": source_url,
    }


# ============================================================
# Section / paragraph extraction (HTML version)
# ============================================================


def _clean_paragraph(p: Tag) -> str:
    """Render a single <p> (or similar) to a markdown string, dropping figures/refs."""
    # Drop figure-only paragraphs (figure is rendered separately)
    if p.select(".ltx_figure, .ltx_table, figure"):
        return ""
    # Drop inline references (we surface them via the figure captions / refs at end)
    for cite in p.select('.ltx_cite, [role="doc-biblioref"]'):
        cite.decompose()
    text = p.get_text(" ", strip=True)
    if not text:
        return ""
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_sections(soup: BeautifulSoup, arxiv_id: str) -> list[dict]:
    """Walk .ltx_section in document order; subsections, figures and tables
    are all emitted as inline markers inside `paragraphs` at their actual
    DOM positions.

    Each entry in `paragraphs` may be:
      - a string (paragraph text)
      - {"type": "subsection", "heading": str} (subsection divider)
      - {"type": "figure", "index": N, "src": str|None, "caption": str}
      - {"type": "table",  "index": N, "caption": str, "markdown": str}

    Why inline instead of separate figures[]/tables[] arrays? Because the
    paper's *first textual reference* to "Fig. 4" or "Table I" can sit in a
    completely different subsection from the visual itself — TABLE I of
    2605.13925v2 sits inside II-B (transmission) but is referenced from II-D
    prose. Carrying inline DOM position is the only way the agent can
    reproduce the original layout instead of guessing.

    The separate top-level `figures` / `tables` arrays are still emitted in
    the JSON (for image download + count reporting), but the agent should
    *only* use the inline markers for placement.
    """
    sections: list[dict] = []
    doc = soup.select_one("article.ltx_document") or soup
    base = html_url_for(arxiv_id)
    state = {"fig_idx": 0, "tab_idx": 0}
    for sec in doc.select(".ltx_section"):
        heading_tag = sec.select_one("h2.ltx_title")
        heading = heading_tag.get_text(" ", strip=True) if heading_tag else ""
        paragraphs: list = []
        _emit_block_children(sec, heading_tag, paragraphs, state, base)
        if heading or paragraphs:
            sections.append({"heading": heading, "paragraphs": paragraphs})
    return sections


def _emit_block_children(parent: Tag, skip_tag: Tag | None, out: list,
                          state: dict, base: str) -> None:
    """Recursively walk a section's children, emitting paragraphs, subsection
    dividers, and inline figure/table markers at their DOM positions."""
    for child in parent.children:
        if not isinstance(child, Tag):
            continue
        if skip_tag is not None and child is skip_tag:
            continue
        # Nested subsection -> emit heading, recurse
        if child.name in ("section", "div") and "ltx_subsection" in (child.get("class") or []):
            sub_h = child.select_one("h3.ltx_title, h4.ltx_title")
            if sub_h:
                out.append({"type": "subsection", "heading": sub_h.get_text(" ", strip=True)})
            _emit_block_children(child, sub_h, out, state, base)
            continue
        # Inline figure at this DOM position
        if "ltx_figure" in (child.get("class") or []):
            state["fig_idx"] += 1
            src = _resolve_figure_src(child, base)
            cap_tag = child.select_one("figcaption")
            cap = cap_tag.get_text(" ", strip=True) if cap_tag else ""
            out.append({"type": "figure", "index": state["fig_idx"], "src": src, "caption": cap})
            continue
        # Inline table at this DOM position
        if "ltx_table" in (child.get("class") or []):
            inner = child.select_one("table")
            if not inner:
                continue
            state["tab_idx"] += 1
            cap_tag = child.select_one("figcaption")
            cap = cap_tag.get_text(" ", strip=True) if cap_tag else ""
            out.append({
                "type": "table",
                "index": state["tab_idx"],
                "caption": cap,
                "markdown": _table_to_markdown(inner),
            })
            continue
        # Plain paragraph
        if child.name == "p" or "ltx_para" in (child.get("class") or []):
            text = _clean_paragraph(child)
            if text:
                out.append(text)


# ============================================================
# Figure extraction
# ============================================================


def _resolve_figure_src(elem: Tag, base: str) -> str | None:
    """Return absolute URL of the figure's image, or None if no image source.

    arXiv's LaTeXML HTML uses both <img src> (PNG/JPG) and <object data>
    (SVG timelines / schematics). Prefer <img>, fall back to <object>.
    """
    img = elem.select_one("img")
    if img and img.get("src") and not img["src"].startswith("data:"):
        return urljoin(base, img["src"])
    obj = elem.select_one("object")
    if obj and obj.get("data"):
        return urljoin(base, obj["data"])
    return None


def extract_figures(soup: BeautifulSoup, arxiv_id: str) -> list[dict]:
    """Collect every .ltx_figure in document order, even when no image exists.

    Returns one entry per figure:
      - {"index": N, "src": "https://...", "caption": "..."} when an <img> or
        <object data=...> is present (covers PNG / JPG / SVG sources)
      - {"index": N, "src": None,            "caption": "..."} when only a caption
        exists (rare — the agent keeps a text-only reference in the markdown)
    """
    figures: list[dict] = []
    base = html_url_for(arxiv_id)
    for idx, fig in enumerate(soup.select(".ltx_figure"), 1):
        src_field = _resolve_figure_src(fig, base)
        caption_tag = fig.select_one("figcaption")
        caption = caption_tag.get_text(" ", strip=True) if caption_tag else ""
        figures.append({"index": idx, "src": src_field, "caption": caption})
    return figures


# ============================================================
# Table extraction
# ============================================================


def _table_to_markdown(table_tag: Tag) -> str:
    """Render a <table> to a GitHub-flavored markdown table.

    Uses first row as the header. Cells joined by ' | '; rows separated by '---'.
    Whitespace inside cells collapsed; empty cells rendered as a single space.
    """
    rows: list[list[str]] = []
    for tr in table_tag.select("tr"):
        cells = tr.select("th, td")
        if not cells:
            continue
        row = [re.sub(r"\s+", " ", c.get_text(" ", strip=True)) for c in cells]
        rows.append(row)

    if not rows:
        return ""

    # Pad rows to a uniform width so columns line up
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]

    header, *body = rows
    lines = ["| " + " | ".join(header) + " |",
             "| " + " | ".join(["---"] * width) + " |"]
    for r in body:
        lines.append("| " + " | ".join(r) + " |")
    return "\n".join(lines)


def extract_tables(soup: BeautifulSoup) -> list[dict]:
    """Collect .ltx_table elements in document order, with caption + markdown body."""
    tables: list[dict] = []
    for idx, tab in enumerate(soup.select(".ltx_table"), 1):
        # Find the actual <table> (ltx_table is the float wrapper)
        inner = tab.select_one("table")
        if not inner:
            continue
        caption_tag = tab.select_one("figcaption")
        caption = caption_tag.get_text(" ", strip=True) if caption_tag else ""
        tables.append({
            "index": idx,
            "caption": caption,
            "markdown": _table_to_markdown(inner),
        })
    return tables


# ============================================================
# Image download
# ============================================================


async def download_one(
    client: httpx.AsyncClient,
    url: str,
    out_path: Path,
    sem: asyncio.Semaphore,
) -> str | None:
    async with sem:
        try:
            resp = await client.get(url, timeout=20.0, follow_redirects=True)
            resp.raise_for_status()
            out_path.write_bytes(resp.content)
            return str(out_path)
        except Exception as e:
            print(f"  ⚠ 图片下载失败 {url}: {e}", file=sys.stderr)
            return None


async def download_figures(figures: list[dict], img_dir: Path) -> dict[str, str]:
    """Return mapping: absolute_url -> local relative path (./images/fig_NNN.<ext>)."""
    img_dir.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(IMAGE_CONCURRENCY)
    async with httpx.AsyncClient(
        proxy=PROXY,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    ) as client:
        tasks = []
        for fig in figures:
            ext_match = re.search(r"\.([a-zA-Z]{2,5})(?:\?|$)", fig["src"])
            ext = ext_match.group(1).lower() if ext_match else "png"
            if ext not in {"png", "jpg", "jpeg", "gif", "webp", "svg"}:
                ext = "png"
            out_path = img_dir / f"fig_{fig['index']:03d}.{ext}"
            tasks.append(download_one(client, fig["src"], out_path, sem))
        results = await asyncio.gather(*tasks, return_exceptions=False)

    url_map: dict[str, str] = {}
    for fig, local in zip(figures, results):
        if local:
            url_map[fig["src"]] = f"./images/fig_{fig['index']:03d}.{Path(local).suffix.lstrip('.')}"
    return url_map


# ============================================================
# Markdown assembly (structure only — agent translates paragraphs)
# ============================================================


def build_structured_markdown(
    meta: dict,
    sections: list[dict],
    figures: list[dict],
    tables: list[dict],
    url_map: dict[str, str],
) -> str:
    """Emit a structured markdown outline with English paragraphs in place.

    The invoking agent (Claude) reads this and produces the bilingual alternating
    version. We keep the original English paragraphs here so translation can map
    1:1 to source. Subsection dividers are emitted as `### <heading>` headings,
    and inline figure / table markers from the JSON are emitted at their DOM
    positions (so the agent sees where each figure/table actually sits in the
    paper, not just an inventory at the end).
    """
    lines: list[str] = []

    # Abstract
    if meta.get("abstract"):
        lines.append("## Abstract")
        lines.append("")
        lines.append(meta["abstract"])
        lines.append("")

    # Sections with inline figures + tables at their DOM positions.
    # Use the inline `paragraphs` markers (truth) — figures/tables arrays
    # are only consulted for image download URLs.
    for sec in sections:
        if sec["heading"]:
            lines.append(f"## {sec['heading']}")
            lines.append("")
        for p in sec["paragraphs"]:
            if isinstance(p, dict) and p.get("type") == "subsection":
                lines.append(f"### {p['heading']}")
                lines.append("")
                continue
            if isinstance(p, dict) and p.get("type") == "figure":
                caption = p.get("caption") or f"Figure {p['index']}"
                src = p.get("src")
                if src:
                    local = url_map.get(src, src)
                    lines.append(f"![{caption}]({local})")
                else:
                    lines.append(f"_(Figure {p['index']} — HTML build has no image; caption-only)_")
                    lines.append("")
                    lines.append(f"*Fig. {p['index']}: {caption}*")
                lines.append("")
                continue
            if isinstance(p, dict) and p.get("type") == "table":
                cap = p.get("caption") or f"Table {p['index']}"
                lines.append(f"**Table {p['index']} — {cap}**")
                lines.append("")
                if p.get("markdown"):
                    lines.append(p["markdown"])
                lines.append("")
                continue
            # Plain paragraph string
            lines.append(p)
            lines.append("")

    return "\n".join(lines)


# ============================================================
# Main entry
# ============================================================


async def fetch_paper(url: str, output_dir: Path | None = None) -> dict:
    """Fetch an arxiv paper; return structured JSON to stdout (via caller)."""
    if output_dir is None:
        output_dir = Path(tempfile.mkdtemp(prefix="arxiv_fetch_"))
    else:
        output_dir = Path(output_dir)

    img_dir = output_dir / "images"
    img_dir.mkdir(parents=True, exist_ok=True)

    try:
        arxiv_id, source_url = normalize_arxiv_url(url)
    except ValueError as e:
        return {
            "success": False,
            "error": f"URL 解析失败: {e}",
            "output_dir": str(output_dir),
            "markdown_path": "",
            "image_dir": str(img_dir),
        }

    print(f"🔄 正在抓取 arxiv:{arxiv_id}", file=sys.stderr)
    print(f"   来源: {source_url}", file=sys.stderr)

    async with httpx.AsyncClient(
        proxy=PROXY,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    ) as client:
        # 1) abs (always works, gives title/authors/abstract/pubDate)
        abs_url = f"https://arxiv.org/abs/{arxiv_id}"
        try:
            abs_html = await fetch_html(client, abs_url)
        except Exception as e:
            return {
                "success": False,
                "error": f"abs 页面抓取失败: {e}",
                "output_dir": str(output_dir),
                "markdown_path": "",
                "image_dir": str(img_dir),
            }

        abs_soup = BeautifulSoup(abs_html, "html.parser")
        meta = extract_metadata(abs_soup, arxiv_id, source_url)

        # 2) try html version for sections + figures + tables
        html_url = html_url_for(arxiv_id)
        sections: list[dict] = []
        figures: list[dict] = []
        tables: list[dict] = []
        html_soup: BeautifulSoup | None = None
        html_available = False

        # arXiv now serves HTML for nearly every paper; even when the user
        # passed an abs URL, prefer the HTML rendering for the body extraction.
        if source_url != html_url:
            print(f"   ↪ 重定向到 HTML 版本: {html_url}", file=sys.stderr)

        try:
            html_resp = await client.get(html_url, timeout=30.0)
            if html_resp.status_code == 200 and "ltx_document" in html_resp.text:
                html_soup = BeautifulSoup(html_resp.text, "lxml")
                html_available = True
                # HTML version metadata may be richer than abs — overwrite if abs was empty
                html_meta = extract_metadata(html_soup, arxiv_id, html_url)
                for k in ("title", "authors", "abstract", "categories"):
                    if html_meta.get(k) and not meta.get(k):
                        meta[k] = html_meta[k]
                sections = extract_sections(html_soup, arxiv_id)
                figures = extract_figures(html_soup, arxiv_id)
                tables = extract_tables(html_soup)
        except Exception as e:
            print(f"  ⚠ html 页面抓取失败，回退到 abs: {e}", file=sys.stderr)

        print(f"📄 标题: {meta.get('title', '?')[:80]}", file=sys.stderr)
        print(f"👤 作者: {', '.join(meta.get('authors', []))[:80]}", file=sys.stderr)
        print(f"📅 日期: {meta.get('pubDate', '?')}", file=sys.stderr)
        print(
            f"📚 sections={len(sections)} figures={len(figures)} tables={len(tables)} (html={'yes' if html_available else 'no'})",
            file=sys.stderr,
        )

        # 3) download figures (only if HTML available and image src exists)
        url_map: dict[str, str] = {}
        figures_with_src = [f for f in figures if f.get("src")]
        if figures_with_src:
            try:
                url_map = await download_figures(figures_with_src, img_dir)
            except Exception as e:
                print(f"  ⚠ 图片下载失败: {e}", file=sys.stderr)

        # 4) write structured markdown draft for the agent to translate
        body = build_structured_markdown(meta, sections, figures, tables, url_map)
        md_path = output_dir / "index.md"
        md_path.write_text(body, encoding="utf-8")

        print(f"✅ 抓取完成: {md_path}", file=sys.stderr)

        return {
            "success": True,
            "metadata": meta,
            "sections": sections,
            "figures": [
                {"index": f["index"], "src": f["src"], "caption": f["caption"]}
                for f in figures
            ],
            "tables": tables,
            "html_available": html_available,
            "output_dir": str(output_dir),
            "markdown_path": str(md_path),
            "image_dir": str(img_dir),
            "error": None,
        }


def main():
    import argparse

    parser = argparse.ArgumentParser(description="抓取 arXiv 论文 (html/abs)")
    parser.add_argument("url", help="arxiv URL (https://arxiv.org/html/<id> 或 /abs/<id>) 或裸 id")
    parser.add_argument("output_dir", nargs="?", default=None, help="输出目录（可选）")

    args = parser.parse_args()
    output_dir = Path(args.output_dir) if args.output_dir else None

    try:
        result = asyncio.run(fetch_paper(args.url, output_dir))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if not result["success"]:
            sys.exit(1)
    except Exception as e:
        result = {
            "success": False,
            "error": f"抓取失败: {e}",
            "output_dir": "",
            "markdown_path": "",
            "image_dir": "",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()