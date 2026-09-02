#!/usr/bin/env node
/**
 * Bootstrap entry for `npx github:wkevin/kb-curio init <dir>` and similar
 * flows that download the monorepo from GitHub without a pre-built dist/.
 *
 * Flow:
 *   1. npx downloads the repo tarball (no build artifacts).
 *   2. npx looks up the root `bin.kb-curio` (this file) and execs it.
 *   3. We check whether the CLI has been built (packages/cli/dist/cli.js).
 *      If not, we run `pnpm install` + `pnpm --filter @kb-curio/cli build`
 *      against the monorepo root.
 *   4. We re-exec the built CLI with the original args, which lets the
 *      existing local-mode logic in init() find the monorepo (via
 *      findMonorepoFromCli) and write a `link:` dep to the scaffolded
 *      project's package.json — no manual git clone / pnpm install /
 *      pnpm build from the user.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const cliDist = resolve(repoRoot, 'packages/cli/dist/cli.js');

if (!existsSync(cliDist)) {
  process.stderr.write('[kb-curio] First-time setup: installing deps and building the CLI...\n');
  execSync('pnpm install --prefer-offline', { cwd: repoRoot, stdio: 'inherit' });
  execSync('pnpm --filter @kb-curio/cli build', { cwd: repoRoot, stdio: 'inherit' });
}

const result = spawnSync('node', [cliDist, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 0);
