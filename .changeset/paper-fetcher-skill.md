---
'@kb-curio/core': minor
'@kb-curio/cli': patch
---

Add `paper-fetcher` skill for arxiv HTML pages with bilingual paragraph-alternating rendering.

## What the skill does

`paper-fetcher` mirrors `article-fetcher`'s directory layout and CLI ergonomics, but is specialized for `arxiv.org/html/<id>` (with `/abs/<id>` as fallback — the script logs a `↪ 重定向到 HTML 版本` line when it converts). Body uses 段落交替式 — each English paragraph is followed immediately by its Chinese translation in single-column vertical flow. No new remark/rehype plugin required.

The skill ships at `packages/core/skills/paper-fetcher/` with:

- `SKILL.md` — full skill spec covering dedup, env checks, fetch flow, paragraph-level translation rules, frontmatter, image placement, glossary, table placement, etc.
- `scripts/arxiv-fetch.py` — fetches abs/ + html/ and emits JSON metadata + inline DOM-anchored section/figure/table markers
- `source-refer.md` / `tag-refer.md` — taxonomy starters
- `scripts/requirements.txt` — httpx / beautifulsoup4 / lxml / markdownify

## Article collection schema extension

Four new optional fields on the `article` content collection, all `.optional()` so existing curated articles keep validating unchanged:

- `arxivId` (string) — populated by paper-fetcher, never parsed as number even when arxiv id is purely numeric
- `authors` (string[])
- `abstract` (string) — kept in frontmatter for now but **the skill no longer writes this field** (it duplicates the bilingual Abstract block in the body)
- `categories` (string[])

## Taxonomy

`packages/core/taxonomy/tags.md` gains a `## 学术论文` section with starter tags (`arxiv`, `machine-learning`, `transformer`, etc.) for paper classification.

## Design points worth flagging

- **`source: academic-papers` is the way to say "this is a paper".** Topics must reflect actual content (`ai-reforge` / `programming-agent` / `programming-language` / `embodied-ai` / …) — `paper-reading` is **not** a topic. The schema's `.min(1)` on `topics` still applies, so each paper must land somewhere.
- **Figures and tables are anchored to the actual DOM walk**, not inferred from the first prose mention. `extract_sections()` emits inline `{"type": "figure", ...}` / `{"type": "table", ...}` markers at the LaTeXML DOM positions; the agent translates by walking `paragraphs[]` in order. Worked example: arxiv 2605.13925v2's TABLE I sits visually in II-B but is referenced from II-D prose; inline markers place it correctly.
- **Both `<img src>` and `<object data>` are recognized image sources**, so SVG timelines / schematics (which arxiv LaTeXML embeds via `<object type="image/svg+xml">`) are captured. SVG files download fine via httpx and are left un-rasterized — `magick` would destroy the vector.
- **The abstract is one paragraph**, not per-sentence pairs — `metadata.abstract` is a single string, render as 1 EN block + 1 ZH block.
- **No `<span class="highlight">`** anywhere; emphasis lives in the per-paper glossary and the prose.

## CLI wiring

`packages/cli/template/scripts/sync-skills.mjs` adds `paper-fetcher` to `SKILL_NAMES` so scaffolded projects get the symlink on `pnpm install`.

## Article-fetcher side

`packages/core/skills/article-fetcher/tag-refer.md` updated to drop the obsolete paper-reading placeholder; `packages/core/src/content.collection.ts` source refine is the four-field schema extension above; `skills-lock.json` gain the `paper-fetcher` entry.
