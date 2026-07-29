# @kb-curio/core

## 0.2.0

### Minor Changes

- First public release of kb-curio as published npm packages.

  `@kb-curio/core` is now an Astro 5 integration. Consumers add it to `astro.config.ts` via `integrations: [kbCurio()]` and expose the article collection through a 3-line `src/content.config.ts` that calls `kbCurioArticleCollection()` from `@kb-curio/core/article-collection`. The four framework routes (`/`, `/article`, `/article/[...slug]`, `/article/rss.xml`) mount themselves via `injectRoute`. The package ships compiled `dist/*.js` plus TypeScript declaration files; raw `.ts` is no longer published.

  The article collection is now the only collection — Marp presentation support (the `presentations` collection, the `build-presentations` script, the `@marp-team/marp-core` dependency, and all `data/presentations/` scaffolding) is removed. The home page is a flat top-10 latest-articles list, the article-list page is a two-column layout with source and keyword facets in a left sidebar, and the banner navigation is driven entirely by `kb-curio.config.ts#topics`.

  RSS feed item links resolve through Astro's `site` config (falling back to the request origin), so local dev and preview deploys no longer point at `https://example.com/article/...`. Set `kb-curio.config.ts#site.url` to your deployment origin to publish a feed with absolute, deployment-correct links. Feed items now carry the rendered `**核心观点：**` / `**延伸洞察：**` sections of each article as HTML content; the body (`原文`) is intentionally excluded.

  `@kb-curio/cli`'s `kb-curio init` auto-detects whether it is running inside the kb-curio monorepo (registers the scaffolded project in `pnpm-workspace.yaml` and pins `@kb-curio/core` via `workspace:*`) or in published-npm mode (pins `@kb-curio/core` at `^0.2.0`). For sibling consumers outside the monorepo, the dependency is written as `link:<relative-path>` so the relative depth between consumer and framework stays correct when directories are renamed. The `scripts/kb-run.mjs` wrapper is gone — scaffolded projects run `astro dev` / `astro build` / `astro preview` directly.

  `@kb-curio/core` also exports `./config-schema` so consumer `kb-curio.config.ts` files can import `KbCurioConfig` directly.

  Migration for existing consumers:

  1. Add `astro.config.ts` mounting `kbCurio()` and `src/content.config.ts` exposing `kbCurioArticleCollection()`.
  2. Drop `scripts/kb-run.mjs`; use `astro dev` / `astro build` / `astro preview` directly.
  3. Re-run `kb-curio init` (or hand-edit) so `package.json` lists `@kb-curio/core` as `workspace:*` or `link:<relative-path>` rather than `link:<absolute-path>`.
  4. Set `site.url` in `kb-curio.config.ts` if you publish an RSS feed.

  Existing downstream projects that still contain `data/presentations/` markdown will leave those files inert — there is no longer a collection loader for them.
