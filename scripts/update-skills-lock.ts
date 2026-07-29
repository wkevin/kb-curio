#!/usr/bin/env tsx

/**
 * update-skills-lock.ts
 *
 * Recompute hashes for every local skill in packages/core/skills and write
 * the updated skills-lock.json. Run this whenever a skill's content changes.
 *
 * Usage: pnpm update:skills-lock
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKILLS_ROOT = path.join(ROOT, 'packages/core/skills');
const LOCK_FILE = path.join(ROOT, 'skills-lock.json');

async function hashSkill(skillDir: string): Promise<string> {
  const files = await collectFiles(skillDir);
  files.sort();
  const h = createHash('sha256');
  for (const file of files) {
    const content = await fs.readFile(file);
    h.update(path.relative(skillDir, file));
    h.update(content);
  }
  return h.digest('hex');
}

async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const entries: Record<string, { source: string; sourceType: 'local'; computedHash: string }> = {};
  const skillDirs = (await fs.readdir(SKILLS_ROOT, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const name of skillDirs) {
    const rel = path.relative(ROOT, path.join(SKILLS_ROOT, name));
    const hash = await hashSkill(path.join(SKILLS_ROOT, name));
    entries[name] = { source: rel, sourceType: 'local', computedHash: hash };
    process.stdout.write(`✓ ${name}: ${hash}\n`);
  }

  const lock = { version: 1, skills: entries };
  await fs.writeFile(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`);
  process.stdout.write(`\nWrote ${LOCK_FILE} with ${skillDirs.length} skill(s).\n`);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.stack ?? err.message}\n`);
  process.exit(2);
});
