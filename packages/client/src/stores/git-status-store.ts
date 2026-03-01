import type { GitStatusInfo } from '@funny/shared';
import { create } from 'zustand';

import { api } from '@/lib/api';

/** Git status for a project root (no threadId) */
export type ProjectGitStatus = Omit<GitStatusInfo, 'threadId' | 'branchKey'>;

/**
 * Compute a stable cache key that groups threads sharing the same git working state.
 * Matches the server-side `computeBranchKey` logic.
 */
export function branchKey(thread: {
  id: string;
  projectId: string;
  branch?: string | null;
  worktreePath?: string | null;
  baseBranch?: string | null;
}): string {
  if (!thread.branch && !thread.worktreePath && thread.baseBranch) return `tid:${thread.id}`;
  if (thread.branch) return `${thread.projectId}:${thread.branch}`;
  return thread.projectId;
}

interface GitStatusState {
  /** Git status keyed by branchKey (threads sharing a branch share one entry) */
  statusByBranch: Record<string, GitStatusInfo>;
  /** Reverse lookup: threadId → branchKey (populated from API responses) */
  threadToBranchKey: Record<string, string>;
  statusByProject: Record<string, ProjectGitStatus>;
  loadingProjects: Set<string>;
  _loadingBranchKeys: Set<string>;
  _loadingProjectStatus: Set<string>;

  fetchForProject: (projectId: string) => Promise<void>;
  fetchForThread: (threadId: string) => Promise<void>;
  fetchProjectStatus: (projectId: string) => Promise<void>;
  updateFromWS: (statuses: GitStatusInfo[]) => void;
  clearForBranch: (bk: string) => void;
}

const FETCH_COOLDOWN_MS = 5_000;
const BRANCH_FETCH_COOLDOWN_MS = 2_000;
const PROJECT_STATUS_COOLDOWN_MS = 2_000;
const _lastFetchByProject = new Map<string, number>();
const _lastFetchByBranch = new Map<string, number>();
const _lastFetchByProjectStatus = new Map<string, number>();

/** @internal Clear cooldown map — only for tests */
export function _resetCooldowns() {
  _lastFetchByProject.clear();
  _lastFetchByBranch.clear();
  _lastFetchByProjectStatus.clear();
}

/** Compare two GitStatusInfo objects for equality on the fields that affect rendering */
function statusEqual(a: GitStatusInfo, b: GitStatusInfo): boolean {
  return (
    a.state === b.state &&
    a.dirtyFileCount === b.dirtyFileCount &&
    a.unpushedCommitCount === b.unpushedCommitCount &&
    a.hasRemoteBranch === b.hasRemoteBranch &&
    a.isMergedIntoBase === b.isMergedIntoBase &&
    a.linesAdded === b.linesAdded &&
    a.linesDeleted === b.linesDeleted
  );
}

/** Only spread statusByBranch when at least one entry actually changed */
function mergeStatuses(
  state: Pick<GitStatusState, 'statusByBranch'>,
  updates: Record<string, GitStatusInfo>,
): { statusByBranch: Record<string, GitStatusInfo> } | Record<string, never> {
  let changed = false;
  for (const [bk, next] of Object.entries(updates)) {
    const prev = state.statusByBranch[bk];
    if (!prev || !statusEqual(prev, next)) {
      changed = true;
      break;
    }
  }
  if (!changed) return {};
  return { statusByBranch: { ...state.statusByBranch, ...updates } };
}

export const useGitStatusStore = create<GitStatusState>((set, get) => ({
  statusByBranch: {},
  threadToBranchKey: {},
  statusByProject: {},
  loadingProjects: new Set(),
  _loadingBranchKeys: new Set(),
  _loadingProjectStatus: new Set(),

  fetchForProject: async (projectId) => {
    if (get().loadingProjects.has(projectId)) return;
    // Skip if fetched recently (prevents duplicate calls during cascading state updates)
    const now = Date.now();
    const lastFetch = _lastFetchByProject.get(projectId) ?? 0;
    if (now - lastFetch < FETCH_COOLDOWN_MS) return;
    _lastFetchByProject.set(projectId, now);
    set((s) => ({ loadingProjects: new Set([...s.loadingProjects, projectId]) }));

    const result = await api.getGitStatuses(projectId);
    if (result.isOk()) {
      const updates: Record<string, GitStatusInfo> = {};
      const keyMap: Record<string, string> = {};
      for (const s of result.value.statuses) {
        updates[s.branchKey] = s;
        keyMap[s.threadId] = s.branchKey;
      }
      set((state) => ({
        ...mergeStatuses(state, updates),
        threadToBranchKey: { ...state.threadToBranchKey, ...keyMap },
      }));
    }
    // Silently ignore errors — git status is best-effort
    set((s) => {
      const next = new Set(s.loadingProjects);
      next.delete(projectId);
      return { loadingProjects: next };
    });
  },

  fetchForThread: async (threadId) => {
    // Use existing branchKey mapping for cooldown; fall back to threadId on first call
    const bk = get().threadToBranchKey[threadId];
    const cooldownKey = bk || `pending:${threadId}`;

    if (bk && get()._loadingBranchKeys.has(bk)) return;
    // Skip if fetched recently (shared cooldown per branch)
    const now = Date.now();
    const lastFetch = _lastFetchByBranch.get(cooldownKey) ?? 0;
    if (now - lastFetch < BRANCH_FETCH_COOLDOWN_MS) return;
    _lastFetchByBranch.set(cooldownKey, now);

    if (bk) {
      set((s) => ({ _loadingBranchKeys: new Set([...s._loadingBranchKeys, bk]) }));
    }
    try {
      const result = await api.getGitStatus(threadId);
      if (result.isOk()) {
        const status = result.value;
        const key = status.branchKey;
        // Update cooldown with the real branchKey
        _lastFetchByBranch.set(key, now);
        set((state) => ({
          ...mergeStatuses(state, { [key]: status }),
          threadToBranchKey: { ...state.threadToBranchKey, [threadId]: key },
        }));
      }
    } finally {
      if (bk) {
        set((s) => {
          const next = new Set(s._loadingBranchKeys);
          next.delete(bk);
          return { _loadingBranchKeys: next };
        });
      }
    }
  },

  fetchProjectStatus: async (projectId) => {
    if (get()._loadingProjectStatus.has(projectId)) return;
    const now = Date.now();
    const lastFetch = _lastFetchByProjectStatus.get(projectId) ?? 0;
    if (now - lastFetch < PROJECT_STATUS_COOLDOWN_MS) return;
    _lastFetchByProjectStatus.set(projectId, now);
    set((s) => ({ _loadingProjectStatus: new Set([...s._loadingProjectStatus, projectId]) }));
    try {
      const result = await api.projectGitStatus(projectId);
      if (result.isOk()) {
        set((s) => ({ statusByProject: { ...s.statusByProject, [projectId]: result.value } }));
      }
    } finally {
      set((s) => {
        const next = new Set(s._loadingProjectStatus);
        next.delete(projectId);
        return { _loadingProjectStatus: next };
      });
    }
  },

  updateFromWS: (statuses) => {
    const updates: Record<string, GitStatusInfo> = {};
    const keyMap: Record<string, string> = {};
    for (const s of statuses) {
      updates[s.branchKey] = s;
      keyMap[s.threadId] = s.branchKey;
    }
    set((state) => ({
      ...mergeStatuses(state, updates),
      threadToBranchKey: { ...state.threadToBranchKey, ...keyMap },
    }));
  },

  clearForBranch: (bk) => {
    set((state) => {
      const next = { ...state.statusByBranch };
      delete next[bk];
      return { statusByBranch: next };
    });
  },
}));

/**
 * Hook to get git status for a specific thread.
 * Resolves threadId → branchKey → status.
 */
export function useGitStatusForThread(threadId: string | undefined): GitStatusInfo | undefined {
  return useGitStatusStore((state) => {
    if (!threadId) return undefined;
    const bk = state.threadToBranchKey[threadId];
    return bk ? state.statusByBranch[bk] : undefined;
  });
}
