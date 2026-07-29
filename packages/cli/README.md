# @kb-curio/cli

`kb-curio init <dir>` — scaffold a new kb-curio knowledge base from the [`@kb-curio/core`](https://www.npmjs.com/package/@kb-curio/core) framework.

This package is part of the kb-curio monorepo. See the [root README](https://github.com/wkevin/kb-curio) for the full picture.

## Usage

After this package is published to npm, run it without installing:

```bash
npx -y @kb-curio/cli init my-new-kb --no-install --no-git
cd my-new-kb && pnpm install && pnpm dev
```

Or install globally:

```bash
npm i -g @kb-curio/cli
kb-curio init my-new-kb
```

## Flags

| Flag              | Effect                                                              |
| ----------------- | ------------------------------------------------------------------- |
| `[dir]`           | Target directory (default: `./<basename>-kb`)                       |
| `-n, --name`      | Project name (default: basename of `dir`)                           |
| `--use-pnpm`      | Use pnpm for installation (default if pnpm is on PATH)               |
| `--use-npm`       | Use npm for installation                                            |
| `--use-yarn`      | Use yarn for installation                                           |
| `--use-bun`       | Use bun for installation                                            |
| `--no-install`    | Skip dependency installation                                        |
| `--no-git`        | Skip `git init` + first commit                                      |
| `--local`         | Force local monorepo mode (rewrites `@kb-curio/core` to `workspace:*` and registers the project in the parent `pnpm-workspace.yaml`) |
| `--no-local`      | Force published-npm mode (keeps `@kb-curio/core` as `^0.1.0`)        |
| `--force`         | Allow non-empty target directory                                    |

## Local vs npm mode

`kb-curio init` decides how the scaffolded project depends on `@kb-curio/core`:

- **Auto-detected local mode** (default in a monorepo): if `kb-curio init` finds a parent directory with both `pnpm-workspace.yaml` and `packages/core/package.json` (with `name: "@kb-curio/core"`), the scaffolded `package.json` is rewritten to `"@kb-curio/core": "workspace:*"`, and the new project is added to the parent `pnpm-workspace.yaml`. `pnpm install` then resolves the framework from the local package.
- **Published-npm mode** (default outside a monorepo): the scaffolded project keeps `"@kb-curio/core": "^0.1.0"` and depends on the framework being installed from npm.

Use `--local` to force the workspace-link setup (even outside a monorepo, where it will only register if `pnpm-workspace.yaml` is found), or `--no-local` to force the npm-version dependency. The `--no-local` flag is what you want when you're scaffolding inside the monorepo but plan to publish the new project to npm without ever linking against the local framework.

The scaffolded `dev` / `build` / `preview` scripts always delegate to `scripts/kb-run.mjs`, a small Node helper that locates `@kb-curio/core` either via the monorepo layout or via `node_modules/@kb-curio/core` and runs Astro from there. This works in both modes without relying on Astro's `--root` flag (which is unreliable when `cwd` differs from the framework directory).

## What gets scaffolded

```
my-new-kb/
├── kb-curio.config.ts     # empty topics, default taxonomy paths
├── package.json           # private, depends on @kb-curio/core + astro
├── AGENTS.md
├── data/
│   └── article/
│       ├── tags.md
│       ├── sources.md
│       ├── fetched.md
│       └── 202601/20260101_example-item/index.md
├── .agents/skills/        # article-fetcher (real directory, not a symlink)
└── .claude/skills/
```

## License

MIT — see [LICENSE](./LICENSE).