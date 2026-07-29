import { execa } from 'execa';

/**
 * Initialize a git repo and create a first commit. Silently skip if git is
 * unavailable or if a repo already exists.
 */
export async function gitInitAndCommit(cwd: string, _pm: string | null): Promise<void> {
  if (await isGitRepo(cwd)) return;

  try {
    await execa('git', ['init', '--initial-branch=main'], { cwd, stdio: 'inherit' });
    await execa('git', ['add', '-A'], { cwd, stdio: 'inherit' });
    await execa('git', ['commit', '-m', 'chore: initial kb-curio scaffold'], {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, GIT_AUTHOR_NAME: 'kb-curio', GIT_AUTHOR_EMAIL: 'kb-curio@local' },
    });
  } catch (err) {
    // Git unavailable or commit failed — non-fatal; user can commit manually
    console.warn(`  ! git init/commit failed: ${(err as Error).message}`);
  }
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execa('git', ['rev-parse', '--git-dir'], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
