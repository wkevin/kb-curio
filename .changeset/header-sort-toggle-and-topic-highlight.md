---
'@kb-curio/core': minor
---

Move the `按收录时间 / 按发布时间` sort toggle out of the article list page
and into the global header as two SVG icons, parallel to RSS / GitHub / theme
toggle. The toggle is now reachable from every page (home, list, detail),
not just `/article/`.

- Header sort icons: inbox (`fetchDate`) + calendar (`pubDate`). Active mode
  paints the icon's background with `--accent` to match the topic nav-link
  treatment, so the user can read "which mode am I in" at a glance.
- Click → navigates to `/article/?topic=...&sort=...` (preserves the current
  topic filter, just swaps the sort). URLs are stable across pages.
- On static builds, a small inline `<script>` in `BaseLayout` reorders the
  `[data-article-list]` DOM using the per-item `data-pub-date` /
  `data-fetch-date` attributes, so sort actually takes effect without an
  SSR adapter. Also paints the matching topic nav link when `?topic=` is
  in the URL, and highlights the article's topics on detail pages
  (`Article.astro` now passes `activeTopics` to `BaseLayout`).
- Removed the now-redundant inline sort-toggle div from
  `pages/article/index.astro`.
- Tolerate both `**核心观点：**` (full-width) and `**核心观点:**` (half-width)
  colons in `rss.xml.ts`'s summary extractor; the document heading convention
  is full-width but hand-written drafts occasionally drift.

Home page: added `data-article-list` + per-item `data-pub-date` /
`data-fetch-date` so the same client-side sort logic also applies to the
"最新文章" section.
