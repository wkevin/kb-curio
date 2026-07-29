# AGENTS.md — kb-curio

> Canonical contributor + project guide. `CLAUDE.md` is a symlink to this file
> so Claude Code (and any tool that looks for `CLAUDE.md`) picks it up
> automatically. **Edit this file** — never edit `CLAUDE.md` directly.

## Project context

kb-curio is both a **framework** and a **research artifact**:

- The **framework** (`packages/core/`, `packages/cli/`) turns a folder of curated
  markdown into a static, searchable research website.
- The **reference demo** (`demo/`) is the framework running against the
  project's own corpus — a meta-experiment: the project documents itself
  with its own tooling.

The research framing: AI is reshaping how developers work. The corpus under
`demo/data/article/` accumulates articles, talks, and reports on this shift,
organized into **topics** (configured in `kb-curio.config.ts#topics` with
id/name/description) and **tags** (see `demo/data/article/tags.md`).

Strict-typing and validation are first-class: every item's frontmatter is
parsed and validated against a Zod schema at `astro build` time. A typo in a
topic id or tag fails the build, not silently produces a broken page.

---

## Repo structure

```
kb-curio/
├── package.json             workspace root; pnpm scripts; packageManager pinned
├── pnpm-workspace.yaml      packages/*, demo/*
├── tsconfig.base.json       shared TS config (strict, ES2022, Bundler)
├── turbo.json               Turborepo task graph
├── biome.json               format + lint + organize-imports
├── README.md                user-facing framework overview
├── AGENTS.md                this file (CLAUDE.md → AGENTS.md)
├── .changeset/              per-PR changelog entries
├── .github/workflows/       CI: ci.yml (lint/typecheck/test/sync), release.yml
│
├── packages/
│   ├── core/                @kb-curio/core — Astro 5 web framework
│   └── cli/                 @kb-curio/cli — scaffolder (kb-curio init)
│
├── demo/                    the framework's reference demo (curated corpus)
│
├── scripts/
│   └── sync-demo-from-template.ts  template → demo drift safety net
│
└── refer/                   untracked, ad-hoc reference dumps
```

## Where to make changes

| You want to…                           | Edit                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Add a new Astro page                   | `packages/core/src/pages/`                                                                       |
| Change topic schema validation         | `packages/core/src/content.collection.ts` + `demo/kb-curio.config.ts#topics`                      |
| Add a new skill to scaffolded projects | `packages/core/skills/<name>/` then run `pnpm --filter @kb-curio/cli sync:template-skills`       |
| Change CLI behavior (init/git/install) | `packages/cli/src/init.ts` / `git.ts` / `package-manager.ts`                                     |
| Change CLI template (what users get)   | `packages/cli/template/` (read `STYLE.md` first)                                                 |
| Add a new topic                        | append to `kb-curio.config.ts#topics`; `article-fetcher` will use the description to auto-assign |
| Pull template changes into the demo    | `pnpm sync:demo:dry` then `pnpm sync:demo`                                                       |
| Bump a published package version       | `pnpm changeset` → write `.changeset/<branch>.md` → merge to `main` to publish                   |

## Dev workflow

```bash
pnpm install                    # install workspace deps
pnpm dev:demo                   # Astro dev server against demo/
pnpm build                      # turbo: build all packages with ^build deps
pnpm test                       # turbo: run tests in every package
pnpm check                      # biome: format check + lint + organize-imports
pnpm check:fix                  # biome: auto-fix what it can
pnpm sync:demo:dry              # see what template → demo drift would change
pnpm sync:demo                  # apply the drift
```

When you change `packages/core/src/content.collection.ts` or
`demo/kb-curio.config.ts`, restart the dev server (Astro 5 caches content
collections aggressively).

## Hard rules

These are non-negotiable. CI and reviewer expectations both enforce them.

- **Biome must pass before commit.** Run `pnpm check` (or `pnpm check:fix`).
- **`packages/core/` or `packages/cli/` changed? Add a changeset.** Run
  `pnpm changeset`, pick the right package(s) and bump. Apps and root tooling
  do **not** need one. Apps are private; changesets are for published APIs.
- **Default to writing no comments.** Only add one when the WHY is non-obvious
  — a hidden constraint, a workaround, an invariant that would surprise a
  reader. Don't explain WHAT (well-named identifiers handle that), don't
  reference tasks/PRs, don't write section banners, don't leave commented-out
  code. If removing a comment wouldn't confuse a future reader, don't write it.
- **No hardcoded topics.** Topics live in `kb-curio.config.ts#topics` and are
  validated by Zod. Adding a new topic means: (1) append to `topics[]` in
  the config, (2) ensure all relevant articles carry `topics: [<new-id>]`
  in frontmatter. The `article-fetcher` skill will then auto-assign
  future fetches to it.
- **Tag taxonomy is global.** Edit `demo/data/article/tags.md` to add a
  tag. Items using a tag not in the file fail Astro validation.
- **Articles are flat.** Path is `data/article/<YYYYMM>/<YYYYMMDD_slug>/`,
  with topic(s) declared in frontmatter `topics:[...]`. No topic-as-folder.
- **Each article carries 1+ topics** when `kb-curio.config.ts#topics` is
  non-empty. The `article-fetcher` skill auto-assigns topics at fetch time
  by matching the article's content against each `topic.description`.
- **Skills are versioned with the framework** at `packages/core/skills/`. The
  CLI template mirrors them via `sync-template-skills.mjs` at `prepack` time.
  `skills-lock.json` pins the hashes — do not edit it by hand.
- **Don't add dependencies casually.** `packages/core/` ships to users; every
  dep inflates install size. Justify the addition in the changeset.
- **Template drift is gated by CI.** PRs that touch `packages/cli/template/`,
  `packages/core/`, or `demo/` MUST pass `pnpm sync:demo:dry`, or the
  `templates-moving-ahead-of-demo` warning fires.

## Known issues / follow-ups

- Out-of-tree consumers registered in the root `pnpm-workspace.yaml` (paths
  starting with `..`) are supported by pnpm via internal `path.resolve` but
  not officially documented. If `pnpm install` misbehaves on a sibling,
  scaffold into `packages/<name>/` of the monorepo instead.
- Some items in `demo/data/article/` reference images that don't exist on
  disk; Astro build fails on them but dev mode works (assets loaded lazily).
  See Phase E followup: bulk image-link audit.
- `refer/` at repo root is an untracked ad-hoc reference dump. Decide
  (delete / .gitignore / relocate to `references/`) before first public commit.

## See also

- `README.md` — framework overview, quick start, frontmatter contract
- `packages/core/src/config-schema.ts` — full `kb-curio.config.ts` schema
- `packages/cli/src/init.test.ts` — CLI behavior examples
- `scripts/sync-demo-from-template.ts` — template → demo sync policy
- `packages/cli/template/STYLE.md` — design intent for the CLI template
