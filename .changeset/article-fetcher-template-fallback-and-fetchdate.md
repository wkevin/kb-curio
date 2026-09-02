---
'@kb-curio/cli': patch
---

`article-fetcher` skill template (mirrored into scaffolded projects): overhaul
the WeChat article-fetch flow around an explicit **fallback chain** plus a
small pre-flight **environment check**, and document the `fetchDate`
timestamp semantics.

- **Step 0.5 environment check** (WeChat only): probe `camoufox` binary
  (honoring `$CAMOUFOX_PATH`, falling back to the default path) and
  `$HTTP_PROXY` / `$HTTPS_PROXY` before running the Python script. Print
  an actionable `⚠️ camoufox 二进制未找到` hint with three remediation
  options when the binary is missing.
- **Fallback chain** for `mp.weixin.qq.com` URLs: `wechat-fetch.py`
  headless → `--headed` → `chrome-devtools` MCP → `agent-browser` skill,
  with the explicit "error field prefix" that triggers each promotion.
  Removes the old "if it fails, give up" line; documents the "do not
  retry the same URL more than twice" anti-flood rule.
- **fetchDate semantics**: doc the rule that `fetchDate` is the skill's
  execution-time wall-clock (timezone-aware UTC), distinct from `pubDate`.
  Spells out the `naive datetime + manual 'Z'` anti-pattern that produces
  RSS-reader-visible "future" timestamps, since that's the actual root
  cause and the Python / Node idioms that get it right.
- **RSS `<content>` heading warning**: explicit note that `rss.xml.ts`
  matches `**xxx：**` (full-width colon) for `核心观点` / `延伸洞察`;
  half-width colons silently drop those sections from the feed.