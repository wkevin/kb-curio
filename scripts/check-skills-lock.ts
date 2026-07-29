#!/usr/bin/env tsx

/**
 * check-skills-lock.ts
 *
 * Verify that every skill recorded in skills-lock.json matches the current
 * content on disk. Exit non-zero if any hash disagrees.
 *
 * Why: agent skills are versioned with the framework. If a skill changes
 * without a corresponding lockfile update, downstream consumers (CLI
 * scaffolders, mirrored copies in template/) drift silently.
 *
 * Usage: pnpm check:skills
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOCK_FILE = path.join(ROOT, 'skills-lock.json');

interface SkillEntry {
  source: string;
  sourceType: 'local' | 'github';
  computedHash: string;
}

interface LockFile {
  version: number;
  skills: Record<string, SkillEntry>;
}

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
  const lockRaw = await fs.readFile(LOCK_FILE, 'utf8');
  const lock = JSON.parse(lockRaw) as LockFile;

  let mismatch = 0;
  for (const [name, entry] of Object.entries(lock.skills)) {
    if (entry.sourceType !== 'local') continue;
    const full = path.join(ROOT, entry.source);
    try {
      const actual = await hashSkill(full);
      if (actual !== entry.computedHash) {
        process.stderr.write(`✗ ${name}: hash mismatch\n`);
        process.stderr.write(`  expected: ${entry.computedHash}\n`);
        process.stderr.write(`  actual:   ${actual}\n`);
        mismatch++;
      } else {
        process.stdout.write(`✓ ${name}\n`);
      }
    } catch (_err) {
      process.stderr.write(`✗ ${name}: missing or unreadable (${entry.source})\n`);
      mismatch++;
    }
  }

  if (mismatch > 0) {
    process.stderr.write(
      `\n${mismatch} skill(s) out of sync. Run \`pnpm update:skills-lock\` to refresh.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `\nAll ${Object.keys(lock.skills).length} skill(s) match their lockfile hashes.\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.stack ?? err.message}\n`);
  process.exit(2);
});
