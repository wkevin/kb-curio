import fs from 'node:fs';
import path from 'node:path';

export interface Monorepo {
  root: string;
  frameworkDir: string;
}

const MAX_DEPTH = 6;

function loadFrameworkAt(root: string): Monorepo | null {
  const frameworkDir = path.join(root, 'packages', 'core');
  const pkgPath = path.join(frameworkDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
    if (pkg.name === '@kb-curio/core') return { root, frameworkDir };
  } catch {
    // ignore malformed package.json
  }
  return null;
}

export function findMonorepoRoot(start: string): Monorepo | null {
  let dir = path.resolve(start);
  for (let i = 0; i < MAX_DEPTH; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      const m = loadFrameworkAt(dir);
      if (m) return m;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function findMonorepoFromCli(templateDir: string): Monorepo | null {
  // CLI source layout:  <repo>/packages/cli/template/<templateDir>
  // Three levels up lands at <repo>.
  const candidateRoot = path.resolve(templateDir, '..', '..', '..');
  if (!fs.existsSync(path.join(candidateRoot, 'pnpm-workspace.yaml'))) return null;
  return loadFrameworkAt(candidateRoot);
}
