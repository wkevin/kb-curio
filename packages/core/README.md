# @kb-curio/core

Astro 5 web framework that powers [kb-curio](https://github.com/wkevin/kb-curio) knowledge bases. Renders a folder of curated markdown into a static, searchable research website.

This package is part of the kb-curio monorepo. See the [root README](https://github.com/wkevin/kb-curio) for the full picture.

## What it does

- Reads `kb-curio.config.ts` at the project root for site metadata, topic definitions, and taxonomy paths.
- Loads markdown from `<dataDir>/article/`, validates every frontmatter field against a Zod schema (`title`, `pubDate`, `topics: [id...]`, optional `source`/`tags`/`url`).
- Renders three views:
  - `/` — hero + the 10 most recent articles.
  - `/article/` — flat article list with source/tag facets in the sidebar. Banner navigation is driven entirely by `kb-curio.config.ts#topics`.
  - `/article/<slug>/` — single article.
- Ships a default `taxonomy/sources.md` and `taxonomy/tags.md` plus framework skills (`article-fetcher`).

## Project layout

```
packages/core/
├── src/             Astro pages, layouts, components, content schemas
├── taxonomy/        Default sources.md / tags.md
├── skills/          Framework skills (article-fetcher)
├── scripts/         Build helpers
├── astro.config.ts
└── package.json
```

## License

MIT — see [LICENSE](./LICENSE).