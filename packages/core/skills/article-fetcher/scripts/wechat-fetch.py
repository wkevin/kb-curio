# -*- coding: utf-8 -*-
from __future__ import annotations

# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "camoufox[geoip]",
#     "markdownify",
#     "beautifulsoup4",
#     "httpx",
# ]
# ///

"""
WeChat Article to Markdown — 微信公众号文章抓取 & Markdown 转换工具

使用 Camoufox (反检测浏览器) + BeautifulSoup + markdownify 将微信公众号文章
转换为干净的 Markdown 文件，图片保存到临时目录。

输出格式: 让调用者（skill）决定如何处理和保存文件。
"""

import asyncio
import json
import os
import re
import sys
import tempfile
from pathlib import Path

import httpx
import markdownify
from bs4 import BeautifulSoup
from camoufox.async_api import AsyncCamoufox

PROXY = os.getenv("HTTP_PROXY") or os.getenv("HTTPS_PROXY")
IMAGE_CONCURRENCY = 5

# 本地 camoufox 路径（如果已手动下载）
CAMOUFOX_PATH = os.getenv("CAMOUFOX_PATH") or "/data/software/camoufox/camoufox/camoufox"

# 修复 camoufox 版本检查 bug - monkey patch Version.is_supported
import camoufox
import camoufox.pkgman as pkgman
import camoufox.warnings as cw

def _fixed_is_supported(self):
    return True
pkgman.Version.is_supported = _fixed_is_supported

warnings_path = camoufox.warnings.__file__
with open(warnings_path, 'r') as f:
    content = f.read()
content = content.replace(
    'if not Path(frame.f_code.co_filename).is_relative_to(current_module):',
    'if not str(Path(frame.f_code.co_filename)).startswith(str(current_module)):'
)
with open(warnings_path, 'w') as f:
    f.write(content)
import importlib
importlib.reload(cw)


# ============================================================
# Helpers
# ============================================================


def extract_publish_time(html: str) -> str:
    """从 HTML script 标签中提取发布时间"""
    m = re.search(r"create_time\s*:\s*JsDecode\('([^']+)'\)", html)
    if m:
        val = m.group(1)
        try:
            ts = int(val)
            if ts > 0:
                return format_timestamp(ts)
        except ValueError:
            return val

    m = re.search(r"create_time\s*:\s*'(\d+)'", html)
    if m:
        return format_timestamp(int(m.group(1)))

    return ""


def format_timestamp(ts: int) -> str:
    """Unix timestamp (秒) -> 'YYYY-MM-DD HH:mm:ss' (Asia/Shanghai, UTC+8)"""
    from datetime import datetime, timedelta, timezone

    tz = timezone(timedelta(hours=8))
    dt = datetime.fromtimestamp(ts, tz=tz)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


# ============================================================
# Image Downloading
# ============================================================


async def download_image(
    client: httpx.AsyncClient,
    img_url: str,
    img_dir: Path,
    index: int,
    semaphore: asyncio.Semaphore,
) -> tuple[str, str | None]:
    """下载单张图片到临时目录，返回 (remote_url, local_relative_path | None)"""
    async with semaphore:
        try:
            url = img_url if not img_url.startswith("//") else f"https:{img_url}"

            ext_match = re.search(r"wx_fmt=(\w+)", url) or re.search(
                r"\.(\w{3,4})(?:\?|$)", url
            )
            ext = ext_match.group(1) if ext_match else "png"

            filename = f"img_{index:03d}.{ext}"
            filepath = img_dir / filename

            resp = await client.get(
                url,
                headers={"Referer": "https://mp.weixin.qq.com/"},
                timeout=15.0,
            )
            resp.raise_for_status()
            filepath.write_bytes(resp.content)
            return img_url, f"images/{filename}"
        except Exception as e:
            print(f"  ⚠ 图片下载失败: {e}", file=sys.stderr)
            return img_url, None


async def download_all_images(
    img_urls: list[str], img_dir: Path
) -> dict[str, str]:
    """并发下载所有图片，返回 {remote_url: local_path} 映射"""
    if not img_urls:
        return {}

    print(f"🖼  下载 {len(img_urls)} 张图片 (并发 {IMAGE_CONCURRENCY})...", file=sys.stderr)
    semaphore = asyncio.Semaphore(IMAGE_CONCURRENCY)

    client_kwargs = {"proxy": PROXY} if PROXY else {}
    async with httpx.AsyncClient(**client_kwargs) as client:
        tasks = [
            download_image(client, url, img_dir, i + 1, semaphore)
            for i, url in enumerate(img_urls)
        ]
        results = await asyncio.gather(*tasks)

    url_map = {}
    for remote_url, local_path in results:
        if local_path:
            url_map[remote_url] = local_path

    downloaded = sum(1 for v in url_map.values() if v)
    print(f"  ✅ {downloaded}/{len(img_urls)}", file=sys.stderr)
    return url_map


# ============================================================
# Content Processing
# ============================================================


def extract_metadata(soup: BeautifulSoup, html: str) -> dict:
    """提取文章元数据: 标题、作者、发布时间"""
    title_el = soup.select_one("#activity-name")
    author_el = soup.select_one("#js_name")
    return {
        "title": title_el.get_text(strip=True) if title_el else "",
        "author": author_el.get_text(strip=True) if author_el else "",
        "publish_time": extract_publish_time(html),
    }


def process_content(soup: BeautifulSoup) -> tuple[str, list[dict], list[str]]:
    """
    预处理正文 DOM：修复图片、处理代码块、移除噪声元素。
    返回 (content_html, code_blocks, img_urls)
    """
    content_el = soup.select_one("#js_content")
    if not content_el:
        return "", [], []

    # 1) 图片: data-src -> src (微信懒加载)
    for img in content_el.find_all("img"):
        data_src = img.get("data-src")
        if data_src:
            img["src"] = data_src

    # 2) 代码块: 提取 code-snippet__fix 内容，替换为占位符
    code_blocks = []
    for el in content_el.select(".code-snippet__fix"):
        for line_idx in el.select(".code-snippet__line-index"):
            line_idx.decompose()

        pre = el.select_one("pre[data-lang]")
        lang = pre.get("data-lang", "") if pre else ""

        lines = []
        for code_tag in el.find_all("code"):
            text = code_tag.get_text()
            if re.match(r"^[ce]?ounter\(line", text):
                continue
            lines.append(text)

        if not lines:
            lines.append(el.get_text())

        placeholder = f"CODEBLOCK-PLACEHOLDER-{len(code_blocks)}"
        code_blocks.append({"lang": lang, "code": "\n".join(lines)})
        el.replace_with(soup.new_tag("p", string=placeholder))

    # 3) 移除噪声元素
    for sel in ("script", "style", ".qr_code_pc", ".reward_area"):
        for tag in content_el.select(sel):
            tag.decompose()

    # 4) 收集图片 URL（去重）
    img_urls = []
    seen = set()
    for img in content_el.find_all("img", src=True):
        src = img["src"]
        if src not in seen:
            seen.add(src)
            img_urls.append(src)

    return str(content_el), code_blocks, img_urls


def convert_to_markdown(content_html: str, code_blocks: list[dict]) -> str:
    """HTML -> Markdown，还原代码块，清理格式"""
    md = markdownify.markdownify(
        content_html,
        heading_style="ATX",
        bullets="-",
        convert=["p", "h1", "h2", "h3", "h4", "h5", "h6",
                 "strong", "em", "a", "img", "ul", "ol", "li",
                 "blockquote", "br", "hr", "table", "thead",
                 "tbody", "tr", "th", "td", "pre", "code"],
    )

    for i, block in enumerate(code_blocks):
        placeholder = f"CODEBLOCK-PLACEHOLDER-{i}"
        fenced = f"\n```{block['lang']}\n{block['code']}\n```\n"
        md = md.replace(placeholder, fenced)

    md = md.replace("\u00a0", " ")
    md = re.sub(r"\n{4,}", "\n\n\n", md)
    md = re.sub(r"[ \t]+$", "", md, flags=re.MULTILINE)

    return md


def replace_image_urls(md: str, url_map: dict[str, str]) -> str:
    """替换 Markdown 中的远程图片链接为本地路径，添加防盗链属性"""

    def _replace(m):
        alt, img_url = m.group(1), m.group(2)
        local = url_map.get(img_url)
        if local:
            # 使用 HTML img 标签添加 referrerpolicy 防止防盗链
            return f'<img src="{local}" referrerpolicy="no-referrer" alt="{alt}">'
        return m.group(0)

    return re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", _replace, md)


def build_markdown(meta: dict, body_md: str) -> str:
    """拼接最终 Markdown 文件内容，添加 YAML frontmatter"""
    pub_date = ""
    if meta.get("publish_time"):
        m = re.match(r"(\d{4}-\d{2}-\d{2})", meta["publish_time"])
        if m:
            pub_date = m.group(1)

    author_safe = re.sub(r'[^a-zA-Z0-9\u4e00-\u9fa5]', '-', meta.get("author", "unknown"))
    author_safe = re.sub(r'-+', '-', author_safe).strip('-')[:20]

    lines = ["---"]
    if pub_date:
        lines.append(f"pubDate: {pub_date}")
    if meta.get("title"):
        lines.append(f"title: {meta['title']}")
    if meta.get("author"):
        lines.append(f"author: {meta['author']}")
    lines.append("tags: []")
    lines.append("---\n")

    if meta.get("author"):
        lines.append(f"> 公众号: {meta['author']}")
    if meta.get("publish_time"):
        lines.append(f"> 发布时间: {meta['publish_time']}")
    if meta.get("source_url"):
        lines.append(f"> 原文链接: {meta['source_url']}")
    if meta.get("author") or meta.get("publish_time") or meta.get("source_url"):
        lines.append("")
    lines.extend(["---\n"])

    return "\n".join(lines) + body_md


# ============================================================
# Main
# ============================================================


async def fetch_article(url: str, output_dir: Path | None = None, headless: bool = True) -> dict:
    """
    抓取微信文章，保存到指定目录（不写入任何文件）
    返回格式：
    {
        "success": true/false,
        "metadata": {...},
        "markdown_path": "output_dir/index.md",
        "image_dir": "output_dir/images",
        "error": "错误信息（如果有）"
    }

    Args:
        url: 微信文章 URL
        output_dir: 指定输出目录，默认为临时目录
        headless: 是否使用无头模式，默认 True。遇到验证码时传入 False 切换到有头模式
    """
    # 如果没有指定输出目录，创建临时目录
    if output_dir is None:
        output_dir = Path(tempfile.mkdtemp(prefix="wechat_fetch_"))
    else:
        output_dir = Path(output_dir)

    # 图片目录
    img_dir = output_dir / "images"
    img_dir.mkdir(parents=True, exist_ok=True)

    print(f"🔄 正在抓取: {url}", file=sys.stderr)

    try:
        # 使用 Camoufox 反检测浏览器获取完整 HTML
        mode = "无头模式" if headless else "有头模式"
        print(f"🦊 启动 Camoufox 浏览器 ({mode})...", file=sys.stderr)
        from camoufox.addons import DefaultAddons
        async with AsyncCamoufox(
            headless=headless,
            proxy={"server": PROXY} if PROXY else None,
            executable_path=CAMOUFOX_PATH if Path(CAMOUFOX_PATH).exists() else None,
            exclude_addons=list(DefaultAddons),
        ) as browser:
            page = await browser.new_page()
            await page.goto(url, wait_until="domcontentloaded")
            # 有头模式下增加等待时间，让用户手动通过验证码
            timeout = 30000 if not headless else 60000
            try:
                await page.wait_for_selector("#js_content", timeout=timeout)
            except Exception:
                pass
            await asyncio.sleep(2)
            html = await page.content()

        soup = BeautifulSoup(html, "html.parser")

        # 提取元数据
        meta = extract_metadata(soup, html)
        if not meta["title"]:
            return {
                "success": False,
                "error": "未能提取到文章标题，可能触发了验证码",
                "output_dir": str(output_dir),
                "markdown_path": "",
                "image_dir": str(img_dir),
            }

        meta["source_url"] = url
        print(f"📄 标题: {meta['title']}", file=sys.stderr)
        print(f"👤 作者: {meta['author']}", file=sys.stderr)
        print(f"📅 时间: {meta['publish_time']}", file=sys.stderr)

        # 处理正文
        content_html, code_blocks, img_urls = process_content(soup)
        if not content_html:
            return {
                "success": False,
                "error": "未能提取到正文内容",
                "output_dir": str(output_dir),
                "markdown_path": "",
                "image_dir": str(img_dir),
            }

        # 转 Markdown
        md = convert_to_markdown(content_html, code_blocks)

        # 下载图片（失败时继续）
        try:
            url_map = await download_all_images(img_urls, img_dir)
            md = replace_image_urls(md, url_map)
        except Exception as e:
            print(f"  ⚠ 图片下载失败: {e}", file=sys.stderr)

        # 构建最终 Markdown 并保存
        final_md = build_markdown(meta, md)
        md_path = output_dir / "index.md"
        md_path.write_text(final_md, encoding="utf-8")

        print(f"✅ 抓取完成", file=sys.stderr)
        print(f"📁 输出目录: {output_dir}", file=sys.stderr)
        print(f"📄 Markdown: {md_path}", file=sys.stderr)

        return {
            "success": True,
            "metadata": {
                "title": meta.get("title", ""),
                "author": meta.get("author", ""),
                "publish_time": meta.get("publish_time", ""),
                "source_url": url,
            },
            "output_dir": str(output_dir),
            "markdown_path": str(md_path),
            "image_dir": str(img_dir),
            "error": None,
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "output_dir": str(output_dir),
            "markdown_path": "",
            "image_dir": str(img_dir),
        }


def main():
    # 支持可选的输出目录参数和 headless 参数
    # 用法: python wechat-fetch.py <url> [output_dir] [--headed]
    import argparse

    parser = argparse.ArgumentParser(
        description="抓取微信公众号文章"
    )
    parser.add_argument("url", help="微信公众号文章 URL")
    parser.add_argument(
        "output_dir", nargs="?", default=None, help="输出目录（可选）"
    )
    parser.add_argument(
        "--headed", action="store_true", help="使用有头模式（用于绕过验证码）"
    )

    args = parser.parse_args()

    url = args.url
    output_dir = Path(args.output_dir) if args.output_dir else None
    headless = not args.headed

    if not url.startswith("https://mp.weixin.qq.com/"):
        result = {
            "success": False,
            "error": "请输入有效的微信文章 URL (https://mp.weixin.qq.com/...)",
            "output_dir": "",
            "markdown_path": "",
            "image_dir": "",
        }
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(1)

    try:
        result = asyncio.run(fetch_article(url, output_dir, headless))
        # 输出 JSON 到 stdout
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        result = {
            "success": False,
            "error": f"抓取失败: {e}",
            "output_dir": "",
            "markdown_path": "",
            "image_dir": "",
        }
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
