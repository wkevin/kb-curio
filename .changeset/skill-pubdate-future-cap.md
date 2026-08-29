---
'@kb-curio/core': patch
---

`article-fetcher` skill: cap `pubDate` to "today" in Asia/Shanghai when the
upstream source returns a date in the future (proxy / cache / timezone
mismatch). RSS readers defensively drop future-dated items, which would
silently hide the article from the feed.

- `wechat-fetch.py`: in `build_markdown`, after extracting the date from
  `publish_time`, take `min(candidate, today_0800)` before writing it into
  the YAML frontmatter.
- SKILL.md: document the rule next to the existing `pubDate` guidance,
  noting that MCP / agent-driven fetches should apply the same cap when
  they synthesize a date.

Pure date-only `pubDate` is unaffected in the common case — the cap only
kicks in when an upstream emits a date the reader would consider future.
