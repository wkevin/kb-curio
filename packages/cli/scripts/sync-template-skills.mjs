#!/usr/bin/env node
/**
 * sync-template-skills.mjs
 *
 * Mirror packages/core/skills/* → packages/cli/template/.agents/skills/*
 * as real directory copies. Run as part of `prepack` so the published
 * @kb-curio/cli tarball contains self-contained skill folders (symlinks
 * would point into the publisher's machine and break for consumers).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(REPO_ROOT, 'packages', 'core', 'skills');
const DST = path.join(REPO_ROOT, 'packages', 'cli', 'template', '.agents', 'skills');

if (!fs.existsSync(SRC)) {
  console.error(`Skill source not found at ${SRC}`);
  process.exit(1);
}

fs.mkdirSync(DST, { recursive: true });

// Clear destination
for (const entry of fs.readdirSync(DST)) {
  fs.rmSync(path.join(DST, entry), { recursive: true, force: true });
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

// Copy each skill directory as a real tree.
let count = 0;
for (const skill of fs.readdirSync(SRC)) {
  const srcSkill = path.join(SRC, skill);
  const dstSkill = path.join(DST, skill);
  if (!fs.statSync(srcSkill).isDirectory()) continue;
  copyDirSync(srcSkill, dstSkill);
  count++;
}

console.log(`✓ Synced ${count} skill(s) → packages/cli/template/.agents/skills/`);
