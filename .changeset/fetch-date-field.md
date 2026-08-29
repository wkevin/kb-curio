---
'@kb-curio/core': minor
---

Add optional `fetchDate` frontmatter field (ISO 8601) tracking when the
article was last fetched/edited by the `article-fetcher` skill.

- RSS feed `<pubDate>` now uses `fetchDate ?? pubDate` (fallback to `pubDate`
  for legacy articles), so subscribers see when content entered this
  collection rather than when it was originally published.
- Article list page (`/article/`) gains a sort toggle at the top:
  按收录时间 (default) / 按发布时间. Persisted via `?sort=fetch|pub` query.
- List item layout changes to `<pubDate (muted)> <title> <fetchDate>` so both
  dates are visible without competing with the title.
- Article detail `PostMeta` now shows a 收录：row when `fetchDate` is present.
- Articles without `fetchDate` continue to sort and render exactly as before.
