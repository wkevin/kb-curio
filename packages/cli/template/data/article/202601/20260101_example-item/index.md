---
title: "示例文章：kb-curio 项目长这样"
pubDate: 2026-01-01
author: kb-curio
url: https://example.com/sample-article
source: social-media
topics: ["ai-reforge"]
tags: []
---

This is a sample article shipped with the kb-curio template. It demonstrates the
expected shape of articles under `data/article/<YYYYMM>/<YYYYMMDD_slug>/`.

**核心观点**：

1. kb-curio articles live at `data/article/<YYYYMM>/<YYYYMMDD_slug>/index.md`
2. Frontmatter must declare at least one topic (defined in `kb-curio.config.ts#topics`)
3. Optional `tags:` are validated against `data/article/tags.md`
4. Co-located `images/` folder is the conventional location for article images

**下一步**：删除这个 example item and start curating your own!
