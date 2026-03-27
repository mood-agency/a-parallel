import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const TOAST_DURATION = 5000;

/**
 * Icon size tokens — mirrors the `icon-*` CSS utilities in globals.css.
 * Named after the Tailwind text-* scale so you can pair icon-sm with text-sm.
 *
 * Use these when a component needs to pick an icon size programmatically
 * (e.g. mapping a button size prop to an icon class).
 */
export const ICON_SIZE = {
  '2xs': 'icon-2xs', // 10px
  xs: 'icon-xs', // 12px
  sm: 'icon-sm', // 14px
  base: 'icon-base', // 16px
  lg: 'icon-lg', // 20px
  xl: 'icon-xl', // 24px
} as const;

export type IconSize = keyof typeof ICON_SIZE;

/**
 * Derive the git branch name from a worktree path.
 * Worktree folder: `<projectSlug>-<titleSlug>-<id6>` (hyphens)
 * Git branch:      `<projectSlug>/<titleSlug>-<id6>` (first hyphen → slash)
 */
export function deriveBranchFromWorktreePath(worktreePath: string): string {
  const folder = worktreePath.split('/').pop() ?? '';
  const idx = folder.indexOf('-');
  return idx >= 0 ? `${folder.substring(0, idx)}/${folder.substring(idx + 1)}` : folder;
}

/**
 * Resolve the effective branch for a thread.
 * Falls back to deriving from worktreePath when branch is missing.
 */
export function resolveThreadBranch(thread: {
  branch?: string | null;
  worktreePath?: string | null;
}): string | undefined {
  if (thread.branch) return thread.branch;
  if (thread.worktreePath) return deriveBranchFromWorktreePath(thread.worktreePath);
  return undefined;
}
