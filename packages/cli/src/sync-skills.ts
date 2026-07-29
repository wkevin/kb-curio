/**
 * sync-skills: mirror packages/core/skills/* → packages/cli/template/.agents/skills/*
 *
 * The CLI ships a template/ directory that gets copied into scaffolded projects.
 * Skill content lives in packages/core/skills/ (canonical source); this script
 * mirrors it into the template so the published @kb-curio/cli tarball includes
 * the current skill set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(REPO_ROOT, 'packages', 'core', 'skills');
const DST = path.join(REPO_ROOT, 'packages', 'cli', 'template', '.agents', 'skills');

export async function syncSkills(): Promise<void> {
  if (!fs.existsSync(SRC)) {
    throw new Error(`Skill source not found at ${SRC}`);
  }

  fs.mkdirSync(DST, { recursive: true });

  // Clear destination
  for (const entry of fs.readdirSync(DST)) {
    fs.rmSync(path.join(DST, entry), { recursive: true, force: true });
  }

  // Mirror each skill as a relative symlink
  for (const skill of fs.readdirSync(SRC)) {
    const dstSkill = path.join(DST, skill);
    const relTarget = path.relative(DST, path.join(SRC, skill));
    fs.symlinkSync(relTarget, dstSkill);
  }

  console.log(
    `Synced ${fs.readdirSync(SRC).length} skill(s) from packages/core/skills/ → packages/cli/template/.agents/skills/`,
  );
}
