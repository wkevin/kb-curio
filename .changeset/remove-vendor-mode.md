---
'@kb-curio/cli': major
---

Remove the `--vendor` install mode from `kb-curio init`.

The framework can now be installed into a scaffolded project in two
ways only:

1. **Source repo / monorepo** — `workspace:*` (when the project lives
   inside the framework checkout) or `link:<rel>` (when it lives next
   to it). Detected automatically; opt in explicitly with `--local`.
2. **Published npm** — `^x.y.z` (when the project is outside the
   monorepo). Opt in explicitly with `--no-local`.

The vendor copy (`<dir>/vendor/@kb-curio/core/`, `file:` dep,
`vendor/` in `.gitignore`) is gone. The mode was originally useful
before the first npm publish, when there was no way to validate the
built artifact end-to-end. Now that `@kb-curio/core` is on the
registry, the two remaining modes cover the same ground without the
third source of truth drifting out of sync.

**Breaking for CLI consumers** — any script or CI step that ran
`kb-curio init --vendor` needs to switch to `--local` (for monorepo
development) or `--no-local` (for a published-npm consumer).

Docs:
- README.md: drop the `### \`--vendor\`` section and the `--vendor`
  row from the params table.
- `packages/cli/template/AGENTS.md`: drop the `vendor/` mention from
  the symlink-resync guidance (the symlinks now always point at
  `node_modules/...` since there's only one path to probe).
- `packages/cli/template/scripts/sync-skills.mjs`: drop the
  `vendor/@kb-curio/core/skills` candidate from `CANDIDATES` (and the
  corresponding "Two install modes are supported" comment block).
- `packages/core/scripts/prepack.mjs`: drop the parenthetical that
  names `kb-curio init --vendor` from the install-mode context
  comment.
