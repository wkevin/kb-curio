import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';

/**
 * Detect which package manager to use for a project.
 * Looks for lockfiles first, then falls back to whatever is on PATH.
 */
export async function detectPackageManager(cwd: string): Promise<string | null> {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'package-lock.json'))) return 'npm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock')))
    return 'bun';

  // Walk up the parent chain: a scaffolded project inside the kb-curio
  // monorepo doesn't have its own lockfile, but the monorepo root does.
  for (let d = cwd; d !== path.dirname(d); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(d, 'package-lock.json'))) return 'npm';
    if (fs.existsSync(path.join(d, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(d, 'bun.lockb')) || fs.existsSync(path.join(d, 'bun.lock')))
      return 'bun';
  }

  // Fall back: check what's on PATH
  for (const pm of ['pnpm', 'npm', 'yarn', 'bun']) {
    try {
      await execa(pm, ['--version'], { stdio: 'ignore' });
      return pm;
    } catch {
      // not installed
    }
  }
  return null;
}

/**
 * Install dependencies in the given directory.
 */
export async function install(cwd: string, pm: string): Promise<void> {
  const args =
    pm === 'npm'
      ? ['install']
      : pm === 'pnpm'
        ? ['install']
        : pm === 'yarn'
          ? ['install']
          : pm === 'bun'
            ? ['install']
            : ['install'];

  await execa(pm, args, { cwd, stdio: 'inherit' });
}
