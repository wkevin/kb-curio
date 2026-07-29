/**
 * Sync template files into demo/ (the framework's reference demo).
 *
 * Policy:
 *   - copy-if-missing: placeholders/docs that the demo should also have
 *   - report-diff:    files that exist in both but differ (taxonomy, local state)
 *                     — never auto-merge; print a hint and let a human decide
 *   - skip:           config files that have intentionally diverged; real content
 *
 * Usage:
 *   pnpm sync:demo                # actually write
 *   pnpm sync:demo --dry-run      # show what would change, write nothing
 *
 * Exit code:
 *   0  no changes (or --dry-run with no changes)
 *   1  changes were applied (CI can use this as a "drift detected" signal)
 *   2  error
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEMPLATE_DIR = path.join(ROOT, 'packages/cli/template');
const DEMO_DIR = path.join(ROOT, 'demo');

type Policy = 'copy-if-missing' | 'report-diff' | 'skip';

interface SyncRule {
  /** Path relative to template dir */
  src: string;
  /** Path relative to demo dir */
  dst: string;
  policy: Policy;
  reason: string;
}

/**
 * Ordered list of files to sync. Order matters only for human-readable output.
 *
 * If you add a new file to packages/cli/template/ and want it mirrored into the
 * demo, add an entry here with the appropriate policy.
 */
const RULES: readonly SyncRule[] = [
  // --- Config: intentionally diverged, never touch ---
  {
    src: 'kb-curio.config.ts',
    dst: 'kb-curio.config.ts',
    policy: 'skip',
    reason: 'demo overrides topics + title deliberately',
  },
  {
    src: 'package.json',
    dst: 'package.json',
    policy: 'skip',
    reason: 'demo has workspace deps + extra scripts',
  },

  // --- Placeholder docs: copy if demo lacks them ---
  {
    src: 'AGENTS.md',
    dst: 'AGENTS.md',
    policy: 'copy-if-missing',
    reason: 'project contributor guide for the demo instance',
  },

  // --- Taxonomy: report diff, never auto-merge ---
  {
    src: 'data/article/sources.md',
    dst: 'data/article/sources.md',
    policy: 'report-diff',
    reason: 'source enum; if template adds a new source, demo must opt-in',
  },
  {
    src: 'data/article/tags.md',
    dst: 'data/article/tags.md',
    policy: 'report-diff',
    reason: 'tag taxonomy; demo intentionally pruned (see comment in file)',
  },
  {
    src: 'data/article/fetched.md',
    dst: 'data/article/fetched.md',
    policy: 'report-diff',
    reason: 'per-instance URL dedup log; local state, not template-owned',
  },
];

type Action = 'copied' | 'would-copy' | 'differs' | 'identical' | 'skipped';

interface Report {
  rule: SyncRule;
  action: Action;
  detail?: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

async function processRule(rule: SyncRule, dryRun: boolean): Promise<Report> {
  const srcPath = path.join(TEMPLATE_DIR, rule.src);
  const dstPath = path.join(DEMO_DIR, rule.dst);

  switch (rule.policy) {
    case 'skip':
      return { rule, action: 'skipped', detail: rule.reason };

    case 'copy-if-missing': {
      if (await exists(dstPath)) {
        return { rule, action: 'identical' };
      }
      if (dryRun) {
        return { rule, action: 'would-copy', detail: 'demo missing this file' };
      }
      await fs.mkdir(path.dirname(dstPath), { recursive: true });
      await fs.copyFile(srcPath, dstPath);
      return { rule, action: 'copied', detail: 'demo missing this file' };
    }

    case 'report-diff': {
      const dstContent = await readIfExists(dstPath);
      if (dstContent === null) {
        if (dryRun) {
          return {
            rule,
            action: 'would-copy',
            detail: 'demo missing this file (taxonomy fallback)',
          };
        }
        await fs.mkdir(path.dirname(dstPath), { recursive: true });
        await fs.copyFile(srcPath, dstPath);
        return { rule, action: 'copied', detail: 'demo missing this file (taxonomy fallback)' };
      }
      const srcContent = await fs.readFile(srcPath, 'utf8');
      if (srcContent === dstContent) {
        return { rule, action: 'identical' };
      }
      return {
        rule,
        action: 'differs',
        detail: `template has ${srcContent.length}B, demo has ${dstContent.length}B — review manually`,
      };
    }
  }
}

function printReport(reports: Report[], dryRun: boolean): void {
  const tag = dryRun ? '[dry-run] ' : '';
  const groups: Record<Action, Report[]> = {
    copied: [],
    'would-copy': [],
    differs: [],
    identical: [],
    skipped: [],
  };
  for (const r of reports) groups[r.action].push(r);

  const print = (action: Action, label: string, color: string) => {
    if (groups[action].length === 0) return;
    const lines = groups[action].map((r) => {
      const det = r.detail ? `  (${r.detail})` : '';
      return `  ${r.rule.dst}${det}`;
    });
    process.stdout.write(`\x1b[${color}m${tag}${label} (${groups[action].length}):\x1b[0m\n`);
    process.stdout.write(`${lines.join('\n')}\n`);
  };

  print('would-copy', 'would copy', '36'); // cyan
  print('copied', 'copied', '32'); // green
  print('differs', 'differs (review required)', '33'); // yellow
  print('identical', 'identical', '90'); // gray
  print('skipped', 'skipped (diverged by design)', '90'); // gray
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  if (!(await exists(TEMPLATE_DIR))) {
    process.stderr.write(`error: template dir not found: ${TEMPLATE_DIR}\n`);
    process.exit(2);
  }
  if (!(await exists(DEMO_DIR))) {
    process.stderr.write(`error: demo dir not found: ${DEMO_DIR}\n`);
    process.exit(2);
  }

  const reports = await Promise.all(RULES.map((r) => processRule(r, dryRun)));
  printReport(reports, dryRun);

  const mutationCount = reports.filter(
    (r) => r.action === 'copied' || r.action === 'would-copy',
  ).length;
  const diffCount = reports.filter((r) => r.action === 'differs').length;

  process.stdout.write('\n');
  process.stdout.write(
    `summary: ${mutationCount} file(s) ${dryRun ? 'would be ' : ''}copied, ${diffCount} differ(s)\n`,
  );

  if (!dryRun && mutationCount > 0) {
    process.exit(1); // signal drift to CI
  }
  if (dryRun && (mutationCount > 0 || diffCount > 0)) {
    process.exit(1); // CI hint: drift exists
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.stack ?? err.message}\n`);
  process.exit(2);
});
