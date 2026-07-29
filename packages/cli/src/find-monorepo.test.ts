import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findMonorepoFromCli, findMonorepoRoot } from './find-monorepo.ts';

describe('findMonorepoRoot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-curio-find-monorepo-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the root when packages/core is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    const coreDir = path.join(tmpDir, 'packages', 'core');
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(
      path.join(coreDir, 'package.json'),
      JSON.stringify({ name: '@kb-curio/core', version: '0.1.0' }),
    );

    const project = path.join(tmpDir, 'scaffolded');
    fs.mkdirSync(project);

    const m = findMonorepoRoot(project);
    expect(m).not.toBeNull();
    expect(m?.root).toBe(tmpDir);
    expect(m?.frameworkDir).toBe(coreDir);
  });

  it('returns null when the package name does not match', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages: []\n');
    const coreDir = path.join(tmpDir, 'packages', 'core');
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(
      path.join(coreDir, 'package.json'),
      JSON.stringify({ name: 'some-other-package' }),
    );
    const project = path.join(tmpDir, 'scaffolded');
    fs.mkdirSync(project);

    expect(findMonorepoRoot(project)).toBeNull();
  });

  it('returns null when pnpm-workspace.yaml is absent', () => {
    const coreDir = path.join(tmpDir, 'packages', 'core');
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(
      path.join(coreDir, 'package.json'),
      JSON.stringify({ name: '@kb-curio/core' }),
    );
    const project = path.join(tmpDir, 'scaffolded');
    fs.mkdirSync(project);

    expect(findMonorepoRoot(project)).toBeNull();
  });

  it('walks up to find the monorepo root from a deeply nested dir', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    const coreDir = path.join(tmpDir, 'packages', 'core');
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(
      path.join(coreDir, 'package.json'),
      JSON.stringify({ name: '@kb-curio/core' }),
    );
    const deep = path.join(tmpDir, 'a', 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });

    expect(findMonorepoRoot(deep)?.root).toBe(tmpDir);
  });
});

describe('findMonorepoFromCli', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-curio-cli-monorepo-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the monorepo root when the CLI template sits inside it', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    const coreDir = path.join(tmpDir, 'packages', 'core');
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(
      path.join(coreDir, 'package.json'),
      JSON.stringify({ name: '@kb-curio/core', version: '0.1.0' }),
    );
    const templateDir = path.join(tmpDir, 'packages', 'cli', 'template');
    fs.mkdirSync(templateDir, { recursive: true });

    const m = findMonorepoFromCli(templateDir);
    expect(m).not.toBeNull();
    expect(m?.root).toBe(tmpDir);
    expect(m?.frameworkDir).toBe(coreDir);
  });

  it('returns null when the template dir is in node_modules (npm install)', () => {
    // Simulates `npm install @kb-curio/cli` putting template under node_modules.
    const templateDir = path.join(
      tmpDir,
      'somewhere',
      'node_modules',
      '@kb-curio',
      'cli',
      'template',
    );
    fs.mkdirSync(templateDir, { recursive: true });

    expect(findMonorepoFromCli(templateDir)).toBeNull();
  });

  it('returns null when the candidate root has no pnpm-workspace.yaml', () => {
    // CLI source layout without a workspace marker.
    const templateDir = path.join(tmpDir, 'packages', 'cli', 'template');
    fs.mkdirSync(templateDir, { recursive: true });
    const coreDir = path.join(tmpDir, 'packages', 'core');
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(
      path.join(coreDir, 'package.json'),
      JSON.stringify({ name: '@kb-curio/core' }),
    );

    expect(findMonorepoFromCli(templateDir)).toBeNull();
  });
});
