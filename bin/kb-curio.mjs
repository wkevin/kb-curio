#!/usr/bin/env node
/**
 * Bootstrap entry for `npx github:wkevin/kb-curio init <dir>` and similar
 * flows that download the monorepo from GitHub without a pre-built dist/
 * or node_modules.
 *
 * Flow:
 *   1. npx downloads the repo tarball to `~/.npm/_npx/<hash>/...`.
 *   2. npx looks up the root `bin.kb-curio` (this file) and execs it.
 *   3. We run `pnpm install` (or `npm install` as fallback) at the
 *      monorepo root. This MUST run even if `node_modules/` exists —
 *      npx creates an empty `node_modules/` directory which would
 *      otherwise pass a naive existsSync() check and skip the install,
 *      leaving the workspace deps (commander, etc.) unresolvable.
 *   4. Build the CLI if it isn't already.
 *   5. Run the CLI.
 *   6. If the dep the CLI wrote is a `link:` pointing under
 *      `~/.npm/_npx/...` (npx-mode signal — the cache will be wiped
 *      later, leaving pnpm/Vite unable to resolve), rewrite it to a
 *      portable git URL: `git+https://github.com/wkevin/kb-curio.git
 *      #subpath=packages/core` (universal npm + pnpm syntax).
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const nodeModules = resolve(repoRoot, 'node_modules');
const cliDist = resolve(repoRoot, 'packages/cli/dist/cli.js');

// Pick the package manager. The user is most likely on pnpm (the
// project ships a pnpm-lock.yaml), but `npx` itself is npm's, so we
// can't assume the install path pnpm uses.
function pickPackageManager() {
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    return 'pnpm';
  } catch {
    return 'npm';
  }
}
const pm = pickPackageManager();

// Verify the workspace deps the CLI needs (commander, etc.) are
// actually installed. npx creates an empty `node_modules/` dir, so a
// plain `existsSync(nodeModules)` check would pass even when the deps
// are missing — that's the bug this replaces.
function needsInstall() {
  if (!existsSync(nodeModules)) return true;
  // Spot-check the deps the CLI imports. If any are missing, run
  // install.
  const probe = resolve(nodeModules, '@kb-curio/cli/node_modules/commander');
  if (!existsSync(probe)) return true;
  return false;
}

if (needsInstall()) {
  process.stderr.write(
    `[kb-curio] First-time setup: installing workspace deps with ${pm}...\n`,
  );
  try {
    execSync(`${pm} install`, { cwd: repoRoot, stdio: 'inherit' });
  } catch (err) {
    process.stderr.write(
      `[kb-curio] ERROR: ${pm} install failed. The CLI cannot run without its deps. ` +
        `Try running \`${pm} install\` in ${repoRoot} manually, then re-run this command.\n`,
    );
    process.exit(1);
  }
}

if (!existsSync(cliDist)) {
  process.stderr.write('[kb-curio] Building the CLI...\n');
  try {
    execSync('pnpm --filter @kb-curio/cli build', {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } catch (err) {
    process.stderr.write(
      '[kb-curio] ERROR: CLI build failed. Try running `pnpm --filter @kb-curio/cli build` manually.\n',
    );
    process.exit(1);
  }
}

const result = spawnSync('node', [cliDist, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

// npx-mode dep fix: when invoked via `npx github:...`, the CLI's
// local-mode logic writes `link:../../...` whose target is under
// `~/.npm/_npx/<hash>/...`. That symlink resolves only while the
// cache lives; once npx exits the cache may be wiped, leaving pnpm
// and Vite unable to resolve `@kb-curio/core`. Detect by checking
// whether the link target's path is under an npx temp dir.
//
// The target dir is the second positional arg (argv[2] is the CLI
// subcommand like "init"). Skip flags, take the first non-flag arg.
const userArgs = process.argv.slice(2);
let targetArg = '.';
for (const a of userArgs.slice(1)) {
  if (!a.startsWith('-')) {
    targetArg = a;
    break;
  }
}
const target = resolve(targetArg);
const targetPkg = resolve(target, 'package.json');

if (existsSync(targetPkg)) {
  const pkg = JSON.parse(readFileSync(targetPkg, 'utf8'));
  const dep = pkg.dependencies?.['@kb-curio/core'];

  let needsRewrite = false;
  if (dep && dep.startsWith('link:')) {
    const linkTarget = resolve(target, dep.slice('link:'.length));
    if (linkTarget.includes('/.npm/_npx/')) needsRewrite = true;
  }
  if (dep && /^\^?0\.0\.0$/.test(dep)) needsRewrite = true;

  if (needsRewrite) {
    pkg.dependencies = pkg.dependencies || {};
    // pnpm's git dep syntax for a monorepo subpackage: the `github:`
    // shortcut with a `#commit-or-branch&path:...` fragment works in
    // pnpm 11+ (the older `#subpath=` fragment is rejected).
    pkg.dependencies['@kb-curio/core'] =
      'github:wkevin/kb-curio#main&path:packages/core';
    writeFileSync(targetPkg, `${JSON.stringify(pkg, null, 2)}\n`);

    // pnpm 10+ refuses to run install/build scripts for non-trusted
    // packages by default. The framework's packages/core has a
    // `prepare` (or `build`) script that produces dist/ — without
    // running it, pnpm install leaves node_modules/@kb-curio/core as
    // source without dist/, and downstream tools (Vite, Astro) can't
    // resolve it. `onlyBuiltDependencies` opts this one package back in.
    const workspaceYaml = resolve(target, 'pnpm-workspace.yaml');
    writeFileSync(
      workspaceYaml,
      'onlyBuiltDependencies:\n  - "@kb-curio/core"\n',
    );
  }
}

process.exit(0);
