/**
 * `kb-curio init [dir]` — copy the framework template into <dir>,
 * materialize symlinks, rewrite package.json, optionally install + git init.
 *
 * Designed to be called from a workspace checkout (where packages/cli/template
 * lives) OR from an installed `kb-curio` npm package (where template/ is bundled
 * in the published tarball).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { findMonorepoFromCli, findMonorepoRoot, type Monorepo } from './find-monorepo.js';
import { gitInitAndCommit } from './git.js';
import { detectPackageManager, install as pmInstall } from './package-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the template directory relative to this file.
//   src/init.ts → ../template/        (dev: ts source)
//   dist/cli.js → ../template/        (built: bundled)
const DEFAULT_TEMPLATE_DIR = path.resolve(__dirname, '..', 'template');
// KB_CURIO_TEMPLATE_DIR (testing only): overrides the bundled template dir so
// init's monorepo-from-cli detection can be exercised with a fake layout.
function resolveTemplateDir(): string {
  return process.env.KB_CURIO_TEMPLATE_DIR ?? DEFAULT_TEMPLATE_DIR;
}

export interface InitOptions {
  dir?: string;
  name?: string;
  usePnpm?: boolean;
  useNpm?: boolean;
  useYarn?: boolean;
  useBun?: boolean;
  install?: boolean;
  git?: boolean;
  local?: boolean;
  vendor?: boolean;
  force?: boolean;
  overwrite?: boolean;
}

export async function init(opts: InitOptions): Promise<void> {
  // 1. Resolve target directory
  const rawDir = opts.dir ?? `${path.basename(process.cwd())}-kb`;
  const target = path.resolve(process.cwd(), rawDir);
  const name = opts.name ?? path.basename(target);

  console.log(pc.cyan(`\n  kb-curio — scaffolding into ${pc.bold(target)}\n`));

  // 2. Verify template exists
  const templateDir = resolveTemplateDir();
  if (!fs.existsSync(templateDir) || !fs.existsSync(path.join(templateDir, 'package.json'))) {
    throw new Error(
      `Template not found at ${templateDir}. ` +
        `Run this command from the kb-curio workspace checkout, or install via npm: \`npm i -g @kb-curio/cli\`.`,
    );
  }

  // 3. Verify target is writable / empty
  if (fs.existsSync(target)) {
    const existing = fs.readdirSync(target);
    if (existing.length > 0 && !opts.force) {
      throw new Error(
        `Target directory is not empty: ${target}\n` +
          `Use --force to overwrite, or choose a different directory.`,
      );
    }
  }

  // 4. Copy template/ → target/ (merge semantics: existing files are kept
  // unless --overwrite is passed, so re-running init on a project that
  // already has user data won't clobber it).
  console.log(pc.dim(`  • copying template files…`));
  copyDir(templateDir, target, { overwrite: opts.overwrite });

  // 5. Materialize symlinks (.claude/skills/* → ../.agents/skills/*)
  console.log(pc.dim(`  • materializing skill symlinks…`));
  materializeSkillSymlinks(target);

  // 6. Rewrite target/package.json
  console.log(pc.dim(`  • rewriting package.json (name=${name})…`));
  rewritePackageJson(target, name);

  // 6.5 Vendor mode: copy the framework build output into
  // <target>/vendor/@kb-curio/core and depend on `file:./vendor/...` so
  // the scaffolded project is decoupled from this checkout. Useful before
  // the first npm publish (when the framework isn't on the registry yet)
  // and as a way to validate that the published build is self-contained.
  //
  // --vendor takes priority over --local / --no-local.
  if (opts.vendor) {
    const monorepo = findMonorepoFromCli(resolveTemplateDir());
    if (!monorepo) {
      throw new Error(
        '--vendor requires a kb-curio monorepo to be discoverable from the CLI invocation. ' +
          'Run this command from a checkout that contains packages/core/.',
      );
    }
    const vendorDir = path.join(target, 'vendor', '@kb-curio', 'core');
    copyFrameworkFiles(monorepo.frameworkDir, vendorDir);
    rewriteForLocalMode(target, 'file:./vendor/@kb-curio/core');
    appendToGitignore(target, 'vendor/');
    console.log(
      pc.dim(
        `  • vendored framework build into ${path.relative(process.cwd(), vendorDir) || vendorDir}`,
      ),
    );
  } else {
    // 6.6 Local-mode: rewrite @kb-curio/core to either workspace:* (target
    // inside the parent monorepo) or link:<rel-path> (target is a sibling
    // of the monorepo). Siblings get a relative `link:` so the consumer
    // stays usable when the host's monorepo path changes; they are NOT
    // registered in pnpm-workspace.yaml because pnpm's `workspace:*`
    // resolver walks upward from the consumer to find a workspace.yaml —
    // which siblings can't, hence `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`.
    //
    // `link:` is pnpm-only; `npm install` will fail with
    // `EUNSUPPORTEDPROTOCOL: link:`. This is a deliberate dev-mode
    // tradeoff: `link:` produces a live symlink so framework source edits
    // propagate without re-running `pnpm install --force`, while `file:`
    // would snapshot-copy the framework into a virtual store and require
    // a refresh after every change. We pick the dev-friendly option.
    // Users who need npm can scaffold with `--no-local` (published-npm
    // mode) instead.
    const forceLocal = opts.local === true;
    const forcePublished = opts.local === false;
    const cliMonorepo = !forcePublished ? findMonorepoFromCli(resolveTemplateDir()) : null;
    const targetMonorepo = !forcePublished ? findMonorepoRoot(target) : null;
    const monorepo = cliMonorepo ?? targetMonorepo;
    const useLocal = forceLocal || (!forcePublished && monorepo !== null);
    if (useLocal) {
      if (monorepo) {
        const rel = path.relative(monorepo.root, target);
        const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
        if (inside) {
          rewriteForLocalMode(target, 'workspace:*');
          maybeRegisterInWorkspace(target, monorepo);
          console.log(
            pc.dim(`  • using local framework (workspace link) at ${monorepo.frameworkDir}`),
          );
        } else {
          const linkPath = path.relative(target, monorepo.frameworkDir).split(path.sep).join('/');
          rewriteForLocalMode(target, `link:${linkPath}`);
          console.log(pc.dim(`  • using local framework (link) at ${monorepo.frameworkDir}`));
        }
      } else {
        rewriteForLocalMode(target);
        console.log(
          pc.yellow(
            '  ! --local set but no kb-curio monorepo found in any parent directory; dependency rewritten to workspace:* anyway.',
          ),
        );
      }
    }
  }

  // 7. Optional install
  let pm: string | null = null;
  if (opts.install !== false) {
    const explicitPm = opts.usePnpm
      ? 'pnpm'
      : opts.useNpm
        ? 'npm'
        : opts.useYarn
          ? 'yarn'
          : opts.useBun
            ? 'bun'
            : null;
    pm = explicitPm ?? (await detectPackageManager(target));
    if (pm) {
      console.log(pc.dim(`  • installing dependencies with ${pm}…`));
      await pmInstall(target, pm);
    } else {
      console.log(pc.yellow(`  ! no package manager detected; skipping install`));
    }
  }

  // 8. Optional git init + first commit
  if (opts.git !== false) {
    console.log(pc.dim(`  • git init + first commit…`));
    await gitInitAndCommit(target, pm);
  }

  // 9. Print next steps
  console.log(pc.green(`\n  ✓ kb-curio project ready at ${target}\n`));
  console.log(`  Next steps:`);
  console.log(`    cd ${path.relative(process.cwd(), target) || '.'}`);
  if (!pm) console.log(`    npm install   # or pnpm install`);
  console.log(`    npm run dev   # or pnpm dev`);
  console.log('');
}

function copyDir(src: string, dst: string, opts: { overwrite?: boolean } = {}): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      // Always recurse — when the destination directory exists we want the
      // merged result (existing subtrees preserved, new files copied in).
      // The per-file skip below is what protects user data on re-init.
      copyDir(s, d, opts);
    } else if (entry.isSymbolicLink()) {
      // Resolve symlinks to real directories so scaffolded projects are
      // standalone (don't depend on monorepo layout of the @kb-curio/cli source).
      let realPath: string;
      try {
        realPath = fs.realpathSync(s);
      } catch {
        // dangling — skip
        continue;
      }
      const stat = fs.statSync(realPath);
      if (stat.isDirectory()) {
        copyDir(realPath, d, opts);
      } else {
        if (!opts.overwrite && fs.existsSync(d)) continue;
        fs.copyFileSync(realPath, d);
      }
    } else {
      if (!opts.overwrite && fs.existsSync(d)) continue;
      fs.copyFileSync(s, d);
    }
  }
}

function materializeSkillSymlinks(target: string): void {
  const agentsDir = path.join(target, '.agents', 'skills');
  const claudeDir = path.join(target, '.claude', 'skills');
  if (!fs.existsSync(agentsDir)) return;
  fs.mkdirSync(claudeDir, { recursive: true });

  for (const entry of fs.readdirSync(agentsDir)) {
    const dst = path.join(claudeDir, entry);
    if (fs.existsSync(dst)) continue;
    // Symlink relative to claudeDir's parent: .claude/skills/<x> → ../../.agents/skills/<x>
    fs.symlinkSync(path.join('..', '..', '.agents', 'skills', entry), dst);
  }

  // Also materialize AGENTS.md → CLAUDE.md (so users running Claude Code get the same guide)
  const agentsFile = path.join(target, 'AGENTS.md');
  const claudeFile = path.join(target, 'CLAUDE.md');
  if (fs.existsSync(agentsFile) && !fs.existsSync(claudeFile)) {
    fs.symlinkSync('AGENTS.md', claudeFile);
  }
}

function rewritePackageJson(target: string, name: string): void {
  const pkgPath = path.join(target, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.name = toValidPackageName(name);
  pkg.private = true;
  pkg.version = '0.0.0';
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function rewriteForLocalMode(target: string, value = 'workspace:*'): void {
  const pkgPath = path.join(target, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  if (pkg.dependencies && Object.hasOwn(pkg.dependencies, '@kb-curio/core')) {
    pkg.dependencies['@kb-curio/core'] = value;
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function copyFrameworkFiles(frameworkDir: string, vendorDir: string): void {
  const corePkgPath = path.join(frameworkDir, 'package.json');
  if (!fs.existsSync(corePkgPath)) {
    throw new Error(`Framework package.json not found at ${corePkgPath}`);
  }
  const corePkg = JSON.parse(fs.readFileSync(corePkgPath, 'utf8')) as { files?: string[] };
  const files = corePkg.files ?? [];

  fs.mkdirSync(vendorDir, { recursive: true });
  // npm publish bundles package.json implicitly; mirror that for the
  // vendor copy so the snapshot is consumable by pnpm/npm.
  fs.copyFileSync(corePkgPath, path.join(vendorDir, 'package.json'));
  for (const f of files) {
    const src = path.join(frameworkDir, f);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(vendorDir, f), { recursive: true });
  }
}

function appendToGitignore(target: string, line: string): void {
  const gi = path.join(target, '.gitignore');
  const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  const lines = existing.split(/\r?\n/);
  if (lines.some((l) => l.trim() === line)) return;
  const sep = existing.endsWith('\n') || existing === '' ? '' : '\n';
  fs.writeFileSync(gi, `${existing}${sep}${line}\n`, 'utf8');
}

function maybeRegisterInWorkspace(target: string, monorepo: Monorepo): void {
  const wsPath = path.join(monorepo.root, 'pnpm-workspace.yaml');
  if (!fs.existsSync(wsPath)) return;
  const rel = path.relative(monorepo.root, target).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return;

  const raw = fs.readFileSync(wsPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let inPackages = false;
  let packagesIndent = -1;
  const insertion: string[] = [];
  const newLines: string[] = [];

  for (const line of lines) {
    if (/^\s*packages\s*:\s*$/.test(line)) {
      inPackages = true;
      const indentMatch = line.match(/^(\s*)/);
      packagesIndent = indentMatch?.[1]?.length ?? 0;
      newLines.push(line);
      continue;
    }
    if (inPackages && packagesIndent >= 0) {
      const match = line.match(/^(\s*)/);
      const indent = match?.[1]?.length ?? 0;
      const trimmed = line.trim();
      if (trimmed === '') {
        newLines.push(line);
        continue;
      }
      if (indent <= packagesIndent && !trimmed.startsWith('-')) {
        inPackages = false;
      }
    }
    if (inPackages) {
      const trimmed = line.trim();
      if (trimmed === `- "${rel}"` || trimmed === `- '${rel}'` || trimmed === `- ${rel}`) {
        return;
      }
    }
    newLines.push(line);
  }

  if (inPackages) {
    insertion.push(`  - "${rel}"`);
    const idx = newLines.findIndex((l) => /^\s*packages\s*:\s*$/.test(l));
    if (idx >= 0) {
      let last = idx;
      while (last + 1 < newLines.length) {
        const next: string | undefined = newLines[last + 1];
        if (!next) break;
        const trimmedNext = next.trim();
        if (trimmedNext.startsWith('-') || trimmedNext === '') {
          last += 1;
        } else {
          break;
        }
      }
      newLines.splice(last + 1, 0, ...insertion);
    }
  } else {
    const header = 'packages:';
    const idx = newLines.findIndex((l) => l.trim() === header);
    if (idx >= 0) {
      newLines.splice(idx + 1, 0, `  - "${rel}"`);
    } else {
      newLines.push('packages:', `  - "${rel}"`);
    }
  }

  fs.writeFileSync(wsPath, `${newLines.join('\n')}\n`, 'utf8');
}

function toValidPackageName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-_./]/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'kb-curio-project'
  );
}
