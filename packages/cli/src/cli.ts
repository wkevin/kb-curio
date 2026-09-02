#!/usr/bin/env node
/**
 * kb-curio CLI — entry point.
 *
 * Usage:
 *   kb-curio init [dir]      scaffold a new knowledge base into <dir>
 *   kb-curio sync-skills     mirror skills/ → template/.agents/skills/ (dev use)
 *   kb-curio --help
 */
import { Command } from 'commander';
import pc from 'picocolors';
import { init } from './init.js';
import { syncSkills } from './sync-skills.js';

const program = new Command();

program
  .name('kb-curio')
  .description('Scaffold and manage kb-curio knowledge bases.')
  .version('0.0.1');

program
  .command('init')
  .description('Scaffold a new kb-curio knowledge base into <dir>')
  .argument('[dir]', 'Target directory (default: current directory basename + "-kb")')
  .option('-n, --name <name>', 'Project name (default: basename of <dir>)')
  .option('--use-pnpm', 'Use pnpm for installation')
  .option('--use-npm', 'Use npm for installation')
  .option('--use-yarn', 'Use yarn for installation')
  .option('--use-bun', 'Use bun for installation')
  .option('--no-install', 'Skip dependency installation')
  .option('--no-git', 'Skip git init + first commit')
  .option('--local', 'Force local monorepo mode (workspace:* dependency)')
  .option('--no-local', 'Force published-npm mode (^x.y.z dependency)')
  .option(
    '--overwrite',
    'Overwrite files that already exist in the target (default: skip them — preserves user data on re-init)',
  )
  .option('--force', 'Allow non-empty target directory')
  .action(async (dir: string | undefined, opts) => {
    try {
      await init({ dir, ...opts });
    } catch (err) {
      console.error(pc.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('sync-skills')
  .description('Mirror packages/core/skills/ → packages/cli/template/.agents/skills/ (CLI dev use)')
  .action(async () => {
    try {
      await syncSkills();
    } catch (err) {
      console.error(pc.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
