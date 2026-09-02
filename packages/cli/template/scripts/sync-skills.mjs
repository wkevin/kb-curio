#!/usr/bin/env node
/**
 * sync-skills.mjs — link `.agents/skills/*` to wherever `@kb-curio/core` is.
 *
 * Why this exists
 * ───────────────
 * Claude Code discovers the article-fetcher and blog-creator skills via
 * `.agents/skills/<name>` in the project root (see AGENTS.md). The
 * framework ships these skills, so the canonical copies live in
 * `<wherever @kb-curio/core is>/skills/<name>`. We want `.agents/skills/`
 * to point at those canonical copies — not be a stale duplicate — so
 * any change to the framework's skill is picked up automatically.
 *
 * Two install modes are supported (both produce the same runtime
 * result — symlinks to canonical skill copies — so we only need to probe
 * one path):
 *   1. source-repo / monorepo — `node_modules/@kb-curio/core/skills`
 *      exists when scaffolded next to the framework checkout (resolved by
 *      pnpm/npm via the workspace:*/link: deps written by `init`).
 *   2. published-npm — same path (`node_modules/...`) when scaffolded
 *      against the registry with `^x.y.z` deps.
 *
 * The postinstall hook in `package.json` runs this on every install, so
 * switching between modes is a one-time `pnpm install` away.
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SKILL_NAMES = ['article-fetcher', 'blog-creator'];

const CANDIDATES = [
  'node_modules/@kb-curio/core/skills',
];

const skillsRoot = CANDIDATES.find((p) => existsSync(resolve(PROJECT_ROOT, p)));

if (!skillsRoot) {
  console.warn(
    '[sync-skills] @kb-curio/core not found at any of:\n' +
      CANDIDATES.map((p) => `  - ${p}`).join('\n') +
      '\n.agents/skills/ may be stale — re-run after `pnpm install`.',
  );
  process.exit(0);
}

const linkRoot = resolve(PROJECT_ROOT, '.agents/skills');
mkdirSync(linkRoot, { recursive: true });

let linked = 0;
for (const name of SKILL_NAMES) {
  const target = resolve(PROJECT_ROOT, skillsRoot, name);
  if (!existsSync(target)) {
    // Skill not in this framework version — leave any existing copy alone.
    continue;
  }
  const link = resolve(linkRoot, name);
  rmSync(link, { recursive: true, force: true });
  // symlinkSync takes a string target. Use absolute path so the link
  // resolves correctly even if the project is moved/copied later.
  symlinkSync(target, link);
  linked += 1;
}

console.log(`[sync-skills] linked ${linked} skill(s) to ${skillsRoot}`);
