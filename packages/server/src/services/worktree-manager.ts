import { resolve, dirname, basename, normalize } from 'path';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { git, gitSafe } from '../utils/git-v2.js';

const WORKTREE_DIR_NAME = '.a-parallel-worktrees';

async function getWorktreeBase(projectPath: string): Promise<string> {
  const projectName = basename(projectPath);
  const base = resolve(dirname(projectPath), WORKTREE_DIR_NAME, projectName);
  await mkdir(base, { recursive: true });
  return base;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  isMain: boolean;
}

export async function createWorktree(
  projectPath: string,
  branchName: string,
  baseBranch?: string
): Promise<string> {
  // Verify the repo has at least one commit — worktrees need committed content
  const hasCommits = await gitSafe(['rev-parse', 'HEAD'], projectPath);
  if (!hasCommits) {
    throw new Error(
      'Cannot create worktree: the repository has no commits yet. Please make an initial commit first.'
    );
  }

  const base = await getWorktreeBase(projectPath);
  const worktreePath = resolve(base, branchName.replace(/\//g, '-'));

  if (existsSync(worktreePath)) {
    throw new Error(`Worktree already exists: ${worktreePath}`);
  }

  // If baseBranch is specified, branch from it; otherwise omit to use HEAD
  const args = ['worktree', 'add', '-b', branchName, worktreePath];
  if (baseBranch) args.push(baseBranch);
  await git(args, projectPath);
  return worktreePath;
}

export async function listWorktrees(projectPath: string): Promise<WorktreeInfo[]> {
  const output = await git(['worktree', 'list', '--porcelain'], projectPath);
  const entries: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('worktree ')) {
      if (current.path) entries.push(current as WorktreeInfo);
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('HEAD ')) {
      current.commit = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch refs/heads/'.length);
    }
  }

  if (current.path) entries.push(current as WorktreeInfo);

  // Mark the main worktree (the project root itself)
  const normalizedProject = normalize(projectPath);
  return entries.map((w) => ({
    ...w,
    isMain: normalize(w.path) === normalizedProject,
  }));
}

export async function removeWorktree(projectPath: string, worktreePath: string): Promise<void> {
  await gitSafe(['worktree', 'remove', '-f', worktreePath], projectPath);
}

export async function removeBranch(projectPath: string, branchName: string): Promise<void> {
  await gitSafe(['branch', '-D', branchName], projectPath);
}
