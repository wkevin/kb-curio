# STYLE.md — kb-curio template design intent

> Read this **before** writing any file under `packages/cli/template/`. This
> document describes the design intent of the scaffolded project — its
> defaults, what must stay, what can be customized, and what would surprise
> a user. If a change contradicts this file, the change is wrong.

## What this template is

A scaffolded kb-curio project is a **curated knowledge base**, not a CMS, not
a blog, not a documentation site. It is:

- A folder of curated articles (the corpus)
- A static site that renders them
- A taxonomy that anchors them (topics + tags + sources)

The framework's job is to make the corpus browsable, searchable, and
discoverable. **Content is the product; the framework is invisible.**

## The single data layer

```
data/
└── article/        the curated corpus (flat, multi-topic frontmatter)
```

The corpus has one shape:

| Layer     | Path pattern                          | Frontmatter contract                                                              |
| --------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `article` | `<YYYYMM>/<YYYYMMDD_slug>/index.md`   | `title`, `pubDate`, optional `source`/`url`, required `topics: [id...]`, optional `tags` |

Items are flat. **Topics are frontmatter fields, not folders.** This keeps
cross-topic items discoverable and avoids splitting a single article across
directories.

## Frontmatter is a contract

Every item's frontmatter is parsed and validated against a Zod schema at
`astro build` time. A typo in a topic id or tag fails the build, not silently
produces a broken page. This is the **one rule that is non-negotiable**.

- **`topics: [...]`** — at least one when topics are configured. Each id must
  exist in `kb-curio.config.ts#topics[*].id`. The `article-fetcher` skill
  auto-assigns topics at fetch time by matching the article's content against
  each `topic.description`.
- **`tags: [...]`** — optional. Each tag must exist in `data/article/tags.md`.
- **`source: <value>`** — must be one of the values in `data/article/sources.md`.

When adding a new topic: append to `kb-curio.config.ts#topics` AND ensure
relevant articles carry `topics: [<new-id>]` in frontmatter. When adding a
new tag: append it to the correct section in `tags.md`.

## Taxonomy files are global state

`data/article/sources.md`, `data/article/tags.md`, `data/article/fetched.md`
are the **single source of truth** for the taxonomy. They are plain markdown
with a specific structure:

```
# 来源参考                  (or  # 标签体系（全局）)

## <section-name>

- <value1>
- <value2>
```

The template ships with whatever shape the original kb-curio project uses
(Chinese for this repo, English for international users). Don't translate
one without translating the others.

## `fetched.md` is per-instance state

It tracks URLs the `article-fetcher` skill has already downloaded. The
template ships with an empty stub. **Never put static content here.**

## Convention over configuration

The template's defaults should work for 80% of users. Things that should
**not** be configurable:

- The `<YYYYMM>/<YYYYMMDD_slug>/` path convention
- The frontmatter field names (`title`, `pubDate`, `source`, `topics`)
- The single-layer folder structure (`data/article/`)

Things that **should** be configurable:

- `site.base` (sub-path hosting)
- `site.title`
- `topics` (the configured topic objects with id/name/description)
- `dataDir` (default `./data`, rarely changed)
- Taxonomy file paths (only if the user has a non-standard layout)

If a user wants to do something the template doesn't support, the answer
is "edit the framework", not "add a config flag". Keep the surface small.

## Anti-patterns

- **Don't add a `data/articles/` directory** because "articles" sounds nicer
  than "article". The corpus is called `article`. There is one.
- **Don't add a `published` boolean to frontmatter.** Use `pubDate` in the
  future to schedule, or move the file out of the corpus directory to
  unpublish.
- **Don't add a `summary` field.** The first paragraph of the body is the
  summary. Let the framework render it.
- **Don't prefix slugs with the topic.** `topics: [ai-reforge]` is in
  frontmatter, not in the path. Path stays flat.
- **Don't reorganize items into date-prefixed folders at the top level.**
  Months are the first level precisely because item count per month stays
  bounded (10–30 items, scannable in a single directory listing).

## What the agent should read first

Before writing any template file:

1. `kb-curio.config.ts` — understand the user's configured topics and taxonomy
2. `data/article/<existing-item>/index.md` — see a real item's shape
3. `data/article/tags.md` — see the tag taxonomy
4. `packages/core/src/content.collection.ts` — see the Zod schema

Don't guess the schema from the README. The README is a guide; the Zod
schema is the truth.
