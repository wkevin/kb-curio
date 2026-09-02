# AGENTS.md

> Notes for AI coding agents (Claude Code, etc.) working in this kb-curio project.

## What this is

A kb-curio knowledge base. It uses `@kb-curio/core` (Astro 5) to render curated
articles into a static site.

## Working directory layout

```
.
├── AGENTS.md                    # this file (Claude Code reads as CLAUDE.md via symlink)
├── kb-curio.config.ts           # site config (topics, taxonomy paths, base URL)
├── package.json                 # workspace deps on @kb-curio/core
├── data/
│   ├── article/                 # curated articles (the main KB content)
│   │   ├── tags.md              # global tag taxonomy (one section per category)
│   │   ├── sources.md           # allowed `source:` enum values
│   │   ├── fetched.md           # URL → slug dedup index (auto-managed)
│   │   └── <YYYYMM>/<YYYYMMDD_slug>/
│   │       ├── index.md         # article (frontmatter + body)
│   │       └── images/          # optional
├── .agents/skills/              # symlinks to skills shipped with @kb-curio/core (auto-managed)
├── scripts/
│   └── sync-skills.mjs          # postinstall: rebuild .agents/skills/ symlinks from @kb-curio/core
```

## Frontmatter contract for `data/article/<YYYYMM>/<slug>/index.md`

```yaml
---
title: <string>                         # required
pubDate: <YYYY-MM-DD>                   # required
author: <string>                        # optional
url: <https://...>                      # source URL (required for fetched articles)
source: <one of sources.md values>      # required: social-media | industry-reports | academic-papers | conference-talks
topics: [<topic-id>, ...]               # required: ≥1 when configured, must be in kb-curio.config.ts#topics
tags: [<tag>, ...]                      # optional; must exist in tags.md
draft: <bool>                           # optional, default false
---
```

The zod schema in `packages/core/src/content.collection.ts` validates every item
on `astro build`/`astro dev`. Adding a new topic? Update `kb-curio.config.ts#topics`.

## Available skills

- `.agents/skills/article-fetcher/` — fetch a web article into `data/collection/`
- `.agents/skills/blog-creator/` — create a new blog post

Claude Code will discover these via `.claude/skills/` (symlink to `.agents/skills/`). The `.agents/skills/` entries are **symlinks maintained by `scripts/sync-skills.mjs`** (triggered automatically by `pnpm install` via the `postinstall` hook in `package.json`). To re-sync manually — e.g. after switching between `vendor/` and `node_modules/` install modes, or after pulling framework updates — run `node scripts/sync-skills.mjs`.

## `scripts/kb-run.mjs`

`dev` / `build` / `preview` scripts call `node scripts/kb-run.mjs <astro subcommand>`. The runner locates `@kb-curio/core` either by walking up the parent directories looking for `packages/core/package.json` (local monorepo mode) or by reading `node_modules/@kb-curio/core/package.json` (published-npm mode), then runs Astro from the framework directory with `KB_CURIO_PROJECT` set to this project. So the same scripts work whether the framework was installed from npm or via `workspace:*`.
