#!/usr/bin/env node
/**
 * Bootstrap entry for `npx github:wkevin/kb-curio init <dir>` and similar
 * flows that download the monorepo from GitHub without a pre-built dist/.
 *
 * Flow:
 *   1. npx downloads the repo tarball (no build artifacts).
 *   2. npx looks up the root `bin.kb-curio` (this file) and execs it.
 *   3. We check whether the CLI has been built. We also check whether
 *      node_modules exists (the npx cache can be wiped independently of
 *      the build output). If either is missing, we run the corresponding
 *      setup step against the monorepo root.
 *   4. We re-exec the built CLI. The CLI's local-mode logic finds the
 *      monorepo (it lives in the npx temp dir alongside the tarball),
 *      so it writes a `link:` dep. That works for `pnpm install` inside
 *      the npx temp dir, but when the user's `pnpm install` runs in
 *      `my-new-kb` the link target is wrong (the framework isn't two
 *      directories up — it's deep in `~/.npm/_npx/`).
 *   5. After the CLI runs, when we're in npx mode we copy
 *      `packages/core` into the target's `node_modules/@kb-curio/core`
 *      and rewrite the dep to `file:./node_modules/@kb-curio/core`.
 *      The user's subsequent `pnpm install` then sets up the symlink
 *      inside pnpm's virtual store, and Vite can resolve the module
 *      because it's a real directory (not a broken symlink).
 */
import { execSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const nodeModules = resolve(repoRoot, 'node_modules');
const cliDist = resolve(repoRoot, 'packages/cli/dist/cli.js');

if (!existsSync(nodeModules)) {
  process.stderr.write('[kb-curio] First-time setup: installing workspace deps...\n');
  execSync('pnpm install --prefer-offline', { cwd: repoRoot, stdio: 'inherit' });
}
if (!existsSync(cliDist)) {
  process.stderr.write('[kb-curio] Building the CLI...\n');
  execSync('pnpm --filter @kb-curio/cli build', { cwd: repoRoot, stdio: 'inherit' });
}

const result = spawnSync('node', [cliDist, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

// npx-mode fix: when invoked via `npx github:...`, the script's own
// path lives under `~/.npm/_npx/<hash>/...` rather than the user's
// working copy. The CLI's local-mode logic computes the framework path
// relative to the scaffolded target and writes `link:../../...` which
// only resolves *while the npx cache is still alive* — once the user
// runs `pnpm install` after npx exits, the cache may be wiped, the
// symlink dangles, and pnpm/Vite can't resolve `@kb-curio/core`.
//
// Detection: a simple, robust check on the script's own path. We
// deliberately avoid `npm_lifecycle_event` / `npm_command` env vars:
// npx spawns us via `node <path>`, and those vars aren't reliably
// inherited. The path itself is the source of truth.
const inNpxTarball = here.includes('/.npm/_npx/');

if (inNpxTarball) {
  const targetArg = process.argv[2] || '.';
  const target = resolve(targetArg);
  const targetPkg = resolve(target, 'package.json');

  if (existsSync(targetPkg)) {
    const targetCore = resolve(target, 'node_modules/@kb-curio/core');
    mkdirSync(dirname(targetCore), { recursive: true });
    // Copy the freshly-built framework into the target's node_modules.
    // Cheap (a few MB) and always correct: the user's subsequent
    // `pnpm install` will see the existing local directory and either
    // symlink it through pnpm's virtual store or use it in place.
    cpSync(resolve(repoRoot, 'packages/core'), targetCore, { recursive: true });

    const pkg = JSON.parse(readFileSync(targetPkg, 'utf8'));
    pkg.dependencies = pkg.dependencies || {};
    pkg.dependencies['@kb-curio/core'] = 'file:./node_modules/@kb-curio/core';
    writeFileSync(targetPkg, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

process.exit(0);
