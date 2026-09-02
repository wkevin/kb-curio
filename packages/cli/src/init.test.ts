import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { init } from './init.js';

describe('kb-curio init', () => {
  let tmpDir: string;
  // Snapshot of the real monorepo's pnpm-workspace.yaml. Some tests trigger
  // `maybeRegisterInWorkspace` against the real monorepo (the CLI is bundled
  // from this checkout, so the CLI-source detector always finds it); without
  // restore-on-teardown, a failing test would leave stale tmpDir entries
  // polluting the workspace file across runs.
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const wsPath = path.join(repoRoot, 'pnpm-workspace.yaml');
  let wsBackup = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-curio-test-'));
    wsBackup = fs.existsSync(wsPath) ? fs.readFileSync(wsPath, 'utf8') : '';
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (wsBackup !== '') fs.writeFileSync(wsPath, wsBackup, 'utf8');
  });

  it('scaffolds a project into a fresh directory', async () => {
    const target = path.join(tmpDir, 'my-kb');

    await init({
      dir: target,
      install: false,
      git: false,
    });

    // Required files
    expect(fs.existsSync(path.join(target, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'kb-curio.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'data', 'article', 'tags.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'data', 'article', 'sources.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'data', 'article', 'fetched.md'))).toBe(true);
    expect(
      fs.existsSync(
        path.join(target, 'data', 'article', '202601', '20260101_example-item', 'index.md'),
      ),
    ).toBe(true);

    // Skills mirrored
    expect(fs.existsSync(path.join(target, '.agents', 'skills', 'article-fetcher'))).toBe(true);
    expect(fs.existsSync(path.join(target, '.agents', 'skills', 'blog-creator'))).toBe(true);
    expect(fs.existsSync(path.join(target, '.claude', 'skills', 'article-fetcher'))).toBe(true);

    // package.json rewritten
    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-kb');
    expect(pkg.private).toBe(true);
    expect(pkg.version).toBe('0.0.0');
  });

  it('rejects non-empty target without --force', async () => {
    const target = path.join(tmpDir, 'occupied');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'existing.txt'), 'x');

    await expect(init({ dir: target, install: false, git: false })).rejects.toThrow(/not empty/);
  });

  it('preserves user data on re-init (merge semantics)', async () => {
    const target = path.join(tmpDir, 'preserve-user-data');
    await init({ dir: target, install: false, git: false });

    // User writes their own article into the scaffolded project.
    const userArticleDir = path.join(target, 'data', 'article', '202608', '20260801_user-note');
    fs.mkdirSync(userArticleDir, { recursive: true });
    fs.writeFileSync(path.join(userArticleDir, 'index.md'), '---\ntitle: my note\n---\nkeep me\n');
    // And edits tags.md to something they care about.
    const tagsPath = path.join(target, 'data', 'article', 'tags.md');
    fs.writeFileSync(tagsPath, '# custom tags\n- my-tag\n');

    // Re-init with --force but NOT --overwrite; user data must survive.
    await init({ dir: target, install: false, git: false, force: true });

    expect(fs.existsSync(path.join(userArticleDir, 'index.md'))).toBe(true);
    expect(fs.readFileSync(path.join(userArticleDir, 'index.md'), 'utf8')).toContain('keep me');
    expect(fs.readFileSync(tagsPath, 'utf8')).toBe('# custom tags\n- my-tag\n');
  });

  it('--overwrite refreshes files that already exist', async () => {
    const target = path.join(tmpDir, 'overwrite-on-demand');
    await init({ dir: target, install: false, git: false });

    // Simulate the template gaining a new field after the user already
    // scaffolded: mutate AGENTS.md so we can detect whether --overwrite
    // brings the original back.
    const agentsPath = path.join(target, 'AGENTS.md');
    const original = fs.readFileSync(agentsPath, 'utf8');
    fs.writeFileSync(agentsPath, `${original}\n# user-added comment\n`);

    await init({
      dir: target,
      install: false,
      git: false,
      force: true,
      overwrite: true,
    });
    const after = fs.readFileSync(agentsPath, 'utf8');
    expect(after).not.toContain('# user-added comment');
    expect(after).toBe(original);
  });

  it('sanitizes invalid package names', async () => {
    const target = path.join(tmpDir, 'My Cool Project!');
    await init({ dir: target, install: false, git: false });

    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    expect(pkg.name).toMatch(/^[a-z0-9._/-]+$/);
  });

  it('auto-detects local monorepo and rewrites @kb-curio/core', async () => {
    // The CLI is bundled from the real kb-curio monorepo, so the CLI-source
    // detector finds it regardless of where the target lives. We don't assert
    // on the exact dep string (workspace:* vs link:…) here — that distinction
    // is covered by the dedicated tests below. We just assert it's not the
    // published ^0.1.0 fallback.
    const target = path.join(tmpDir, 'auto-detect-target');
    await init({ dir: target, install: false, git: false });

    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@kb-curio/core']).not.toBe('^0.1.0');
  });

  it('--local flag forces workspace:* even without a monorepo', async () => {
    // Override the CLI-source detector so --local has to rely on the
    // target-walk fallback. The fake template dir copies the real one so
    // init's "template exists" check passes.
    const fakeTemplate = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-curio-template-'));
    const realTemplate = path.resolve(__dirname, '..', 'template');
    fs.cpSync(realTemplate, fakeTemplate, { recursive: true });
    process.env.KB_CURIO_TEMPLATE_DIR = fakeTemplate;
    try {
      const target = path.join(tmpDir, 'forced-local');
      await init({ dir: target, install: false, git: false, local: true });

      const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
      expect(pkg.dependencies['@kb-curio/core']).toBe('workspace:*');
    } finally {
      delete process.env.KB_CURIO_TEMPLATE_DIR;
      fs.rmSync(fakeTemplate, { recursive: true, force: true });
    }
  });

  it('--no-local flag keeps ^0.1.0 even inside a monorepo', async () => {
    // Override CLI-source detector so the test isn't influenced by the real
    // repo's monorepo. Then create a fake monorepo at tmpDir.
    const fakeTemplate = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-curio-template-'));
    const realTemplate = path.resolve(__dirname, '..', 'template');
    fs.cpSync(realTemplate, fakeTemplate, { recursive: true });
    process.env.KB_CURIO_TEMPLATE_DIR = fakeTemplate;
    try {
      fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      const coreDir = path.join(tmpDir, 'packages', 'core');
      fs.mkdirSync(coreDir, { recursive: true });
      fs.writeFileSync(
        path.join(coreDir, 'package.json'),
        JSON.stringify({ name: '@kb-curio/core', version: '0.1.0' }),
      );

      const target = path.join(tmpDir, 'forced-published');
      await init({ dir: target, install: false, git: false, local: false });

      const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
      expect(pkg.dependencies['@kb-curio/core']).toBe('^0.1.0');

      const ws = fs.readFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'utf8');
      expect(ws).not.toMatch(/forced-published/);
    } finally {
      delete process.env.KB_CURIO_TEMPLATE_DIR;
      fs.rmSync(fakeTemplate, { recursive: true, force: true });
    }
  });

  it('scaffolded project is a self-contained Astro project (no kb-run wrapper)', async () => {
    const target = path.join(tmpDir, 'self-contained');
    await init({ dir: target, install: false, git: false });

    // The framework-as-integration shape: astro.config.ts at the project root,
    // src/content.config.ts as the collection shim. No kb-run.mjs wrapper.
    expect(fs.existsSync(path.join(target, 'astro.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'src', 'content.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(target, '.gitignore'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'scripts', 'kb-run.mjs'))).toBe(false);

    const astroCfg = fs.readFileSync(path.join(target, 'astro.config.ts'), 'utf8');
    expect(astroCfg).toMatch(/kbCurio\(\)/);

    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    expect(pkg.scripts.dev).toMatch(/^astro dev/);
    expect(pkg.scripts.build).toMatch(/^astro build/);
    expect(pkg.scripts.preview).toMatch(/^astro preview/);
  });

  it('writes link:<relative> for a sibling of the monorepo', async () => {
    // The CLI is bundled from the real kb-curio repo, so the CLI-source
    // detector resolves to the real monorepo. Scaffolding into a sibling
    // outside the monorepo must produce `link:<rel-path>` (live symlink
    // so framework source edits propagate without `pnpm install --force`)
    // and must NOT pollute the root pnpm-workspace.yaml (workspace:*
    // doesn't resolve for siblings — pnpm walks up from the consumer
    // looking for a workspace.yaml and won't find one).
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const wsPath = path.join(repoRoot, 'pnpm-workspace.yaml');
    const wsBackup = fs.existsSync(wsPath) ? fs.readFileSync(wsPath, 'utf8') : '';
    const target = path.join(repoRoot, '..', `kb-test-sibling-${Date.now()}`);
    try {
      await init({ dir: target, install: false, git: false });

      const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
      const dep = pkg.dependencies['@kb-curio/core'];
      expect(dep).toMatch(/^link:/);
      expect(dep).not.toMatch(/^\/abs/); // not absolute
      expect(dep).toContain('kb-curio/packages/core');
      const linkTarget = dep.replace(/^link:/, '');
      expect(linkTarget.startsWith('.')).toBe(true);

      const ws = fs.readFileSync(wsPath, 'utf8');
      expect(ws).not.toContain(path.basename(target));
      expect(ws).toBe(wsBackup);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
      if (wsBackup !== '') fs.writeFileSync(wsPath, wsBackup, 'utf8');
    }
  });
});
