#!/usr/bin/env node
import { execSync } from 'node:child_process';
/**
 * Prepack hook: build dist/ only if it's not already present.
 *
 * When this package is installed via `file:./packages/core` (a vendored
 * snapshot from `kb-curio init --vendor`, or a `link:` / sibling checkout),
 * dist/ is typically already populated and the dev environment usually
 * lacks tsconfig.build.json + the source dependencies needed to rebuild
 * it. Running `tsc -p tsconfig.build.json` in that case fails with TS5058
 * and npm silently skips the install, leaving consumers with a missing or
 * empty `@kb-curio/core` in node_modules.
 *
 * When this package is being published to a registry, dist/ is not yet
 * present and the script falls through to the real build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const distDir = path.join(pkgRoot, 'dist');
const tsconfigPath = path.join(pkgRoot, 'tsconfig.build.json');

if (fs.existsSync(distDir)) {
  console.log('dist/ already present — skipping tsc build');
  process.exit(0);
}

if (!fs.existsSync(tsconfigPath)) {
  console.error(
    `Cannot build: tsconfig.build.json missing at ${tsconfigPath}.\n` +
      `This usually means the package was installed from a snapshot that ` +
      `forgot to include dist/ (or the dist/ was deleted). Refusing to ` +
      `guess — install from a full source checkout instead.`,
  );
  process.exit(1);
}

console.log('dist/ missing — running tsc -p tsconfig.build.json');
// Resolve tsc relative to the package's own dev deps. We don't rely on
// PATH because npm/pnpm don't always prepend node_modules/.bin when
// invoking lifecycle hooks via `file:`.
const tscBin = path.join(pkgRoot, 'node_modules', '.bin', 'tsc');
const tscCmd = fs.existsSync(tscBin) ? tscBin : 'tsc';
execSync(`${tscCmd} -p ${tsconfigPath}`, { stdio: 'inherit' });
