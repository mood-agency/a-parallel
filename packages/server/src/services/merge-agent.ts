/**
 * MergeAgent — standalone service that discovers worktree branches ready to merge
 * and uses Claude CLI (via ClaudeProcess) to merge them with intelligent conflict resolution.
 *
 * Does NOT depend on AgentRunner, ThreadManager, or WSBroker.
 * Can be invoked standalone or via the automation scheduler.
 */

import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { ClaudeProcess, type CLIMessage, type CLIResultMessage, type CLIAssistantMessage } from './claude-process.js';
import { git, getCurrentBranch, getStatusSummary, deriveGitSyncState, getDefaultBranch } from '../utils/git-v2.js';
import { listWorktrees, type WorktreeInfo } from './worktree-manager.js';
import type { ClaudeModel, GitSyncState } from '@a-parallel/shared';

// ── Types ──────────────────────────────────────────────────

export interface MergeAgentOptions {
  projectPath: string;
  targetBranch?: string;       // Auto-detected if not provided
  model?: ClaudeModel;         // Default: 'sonnet'
  maxTurnsPerMerge?: number;   // Default: 50
  branches?: string[];         // If not provided, auto-discovers from worktrees
}

export interface BranchInfo {
  branch: string;
  worktreePath: string;
  status: GitSyncState;
  commitCount: number;
}

export interface MergeResult {
  branch: string;
  success: boolean;
  hadConflicts: boolean;
  error?: string;
  costUsd?: number;
}

export interface MergeRunResult {
  targetBranch: string;
  results: MergeResult[];
  totalCostUsd: number;
}

// ── Model Mapping ──────────────────────────────────────────

const MODEL_MAP: Record<ClaudeModel, string> = {
  sonnet: 'claude-sonnet-4-5-20250929',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

const MERGE_ALLOWED_TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'];

// ── MergeAgent Class ───────────────────────────────────────

export class MergeAgent extends EventEmitter {
  private projectPath: string;
  private targetBranch: string | undefined;
  private model: ClaudeModel;
  private maxTurnsPerMerge: number;
  private explicitBranches: string[] | undefined;

  constructor(options: MergeAgentOptions) {
    super();
    this.projectPath = options.projectPath;
    this.targetBranch = options.targetBranch;
    this.model = options.model ?? 'sonnet';
    this.maxTurnsPerMerge = options.maxTurnsPerMerge ?? 50;
    this.explicitBranches = options.branches;
  }

  /**
   * Discover worktree branches that are ready to merge.
   * "Ready" means: no dirty files, has commits ahead of target, not already merged.
   */
  async discoverBranches(): Promise<BranchInfo[]> {
    const worktreesResult = await listWorktrees(this.projectPath);
    if (worktreesResult.isErr()) {
      throw new Error(`Failed to list worktrees: ${worktreesResult.error.message}`);
    }

    const worktrees = worktreesResult.value.filter((w) => !w.isMain);

    // Resolve target branch if not provided
    if (!this.targetBranch) {
      const defaultResult = await getDefaultBranch(this.projectPath);
      if (defaultResult.isErr() || !defaultResult.value) {
        throw new Error('Could not determine target branch. Please specify targetBranch.');
      }
      this.targetBranch = defaultResult.value;
    }

    const branches: BranchInfo[] = [];

    for (const wt of worktrees) {
      // Exclude target branch from merge candidates
      if (wt.branch === this.targetBranch) continue;

      // If explicit branches provided, filter to those only
      if (this.explicitBranches && !this.explicitBranches.includes(wt.branch)) continue;

      const summaryResult = await getStatusSummary(wt.path, this.targetBranch, this.projectPath);
      if (summaryResult.isErr()) continue;

      const summary = summaryResult.value;
      const state = deriveGitSyncState(summary);

      // Skip: dirty (uncommitted changes) or already merged or clean (nothing to merge)
      if (state === 'dirty' || state === 'merged' || state === 'clean') continue;

      // Count commits ahead of target
      const commitCount = summary.unpushedCommitCount > 0
        ? summary.unpushedCommitCount
        : await this.getCommitCountAhead(wt.branch);

      if (commitCount === 0) continue;

      branches.push({
        branch: wt.branch,
        worktreePath: wt.path,
        status: state,
        commitCount,
      });
    }

    // Sort by commit count ascending (fewer commits = less conflict risk)
    branches.sort((a, b) => a.commitCount - b.commitCount);

    return branches;
  }

  /**
   * Merge a single branch into the target using Claude for conflict resolution.
   */
  async mergeBranch(branch: string): Promise<MergeResult> {
    const target = this.targetBranch!;

    // Pre-check: working tree must be clean
    const statusResult = await git(['status', '--porcelain'], this.projectPath);
    if (statusResult.isErr()) {
      return { branch, success: false, hadConflicts: false, error: `git status failed: ${statusResult.error.message}` };
    }
    if (statusResult.value.trim()) {
      return { branch, success: false, hadConflicts: false, error: 'Working tree has uncommitted changes' };
    }

    // Pre-check: no index.lock (another git operation in progress)
    const lockPath = resolve(this.projectPath, '.git', 'index.lock');
    if (existsSync(lockPath)) {
      return { branch, success: false, hadConflicts: false, error: 'Git index.lock exists — another git operation is in progress' };
    }

    const prompt = this.buildMergePrompt(branch, target);

    this.emit('merge:branch-start', { branch, target });

    try {
      const result = await this.runClaudeProcess(prompt, branch);
      return result;
    } catch (error: any) {
      // Safety net: abort any in-progress merge
      await this.abortMergeIfNeeded();
      return { branch, success: false, hadConflicts: false, error: error.message || String(error) };
    }
  }

  /**
   * Run the full merge cycle: discover branches, merge each one sequentially.
   */
  async run(): Promise<MergeRunResult> {
    const branches = await this.discoverBranches();
    const target = this.targetBranch!;

    this.emit('merge:start', { branches, targetBranch: target });

    if (branches.length === 0) {
      this.emit('merge:complete', { results: [], targetBranch: target, totalCostUsd: 0 });
      return { targetBranch: target, results: [], totalCostUsd: 0 };
    }

    const results: MergeResult[] = [];
    let totalCostUsd = 0;

    for (const branchInfo of branches) {
      const result = await this.mergeBranch(branchInfo.branch);
      results.push(result);
      totalCostUsd += result.costUsd ?? 0;

      this.emit('merge:branch-done', result);

      // If a merge failed, stop — repo might be in a bad state
      if (!result.success) {
        this.emit('merge:aborted', { branch: branchInfo.branch, reason: result.error });
        break;
      }
    }

    const runResult: MergeRunResult = { targetBranch: target, results, totalCostUsd };
    this.emit('merge:complete', runResult);
    return runResult;
  }

  // ── Private helpers ────────────────────────────────────────

  private async getCommitCountAhead(branch: string): Promise<number> {
    const result = await git(
      ['rev-list', '--count', `${this.targetBranch}..${branch}`],
      this.projectPath,
    );
    if (result.isErr()) return 0;
    return parseInt(result.value.trim(), 10) || 0;
  }

  private buildMergePrompt(branch: string, targetBranch: string): string {
    return `You are a Merge Agent running in a headless environment.
Task: Merge branch '${branch}' into '${targetBranch}'.

Context:
- Repository path: ${this.projectPath}
- You have file system access via Read, Edit, Write tools and Bash for git commands.

Instructions:
1. Execute: \`git checkout ${targetBranch}\`
2. Execute: \`git merge --no-ff ${branch} -m "Merge branch '${branch}' into ${targetBranch}"\`
3. Check status:
   - If NO conflicts: Output "MERGE_OK: ${branch}" and exit.
   - If conflicts exist:
     a. Run \`git status\` to identify conflicted files.
     b. Use the Read tool to read each conflicted file (look for <<<<<<<, =======, >>>>>>> markers).
     c. Understand the intent of BOTH sides of the conflict.
     d. Use the Edit tool to resolve — combine both changes, remove ALL conflict markers.
     e. Run \`git add <file>\` for each resolved file.
     f. Run \`git commit --no-edit\` to complete the merge.
4. Final: Run \`git log --oneline -5\` to confirm.

CRITICAL RULES:
- Preserve functionality from BOTH branches.
- If both sides add to lists/imports, include both additions.
- If both sides modify the same function, integrate both changes.
- Do NOT push to remote.
- If a conflict is impossible to resolve logically without human input:
  1. Run \`git merge --abort\`
  2. Output "MERGE_FAILED: Ambiguous conflict in [filename] — [reason]"
  3. Exit. Do NOT ask the user for input.`;
  }

  private runClaudeProcess(prompt: string, branch: string): Promise<MergeResult> {
    return new Promise((resolve, reject) => {
      const proc = new ClaudeProcess({
        prompt,
        cwd: this.projectPath,
        model: MODEL_MAP[this.model],
        maxTurns: this.maxTurnsPerMerge,
        permissionMode: 'autoEdit',
        allowedTools: MERGE_ALLOWED_TOOLS,
      });

      let resultText = '';
      let hadConflicts = false;
      let costUsd = 0;
      let finished = false;

      proc.on('message', (msg: CLIMessage) => {
        if (msg.type === 'assistant') {
          const assistantMsg = msg as CLIAssistantMessage;
          const textParts = assistantMsg.message.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text);

          const text = textParts.join('\n');
          if (text) {
            resultText = text;
            this.emit('merge:progress', { branch, message: text });
          }

          // Detect conflict markers in tool calls (file reads/edits)
          for (const block of assistantMsg.message.content) {
            if (block.type === 'tool_use' && (block.name === 'Read' || block.name === 'Edit')) {
              hadConflicts = true;
            }
          }
        }

        if (msg.type === 'result') {
          const resultMsg = msg as CLIResultMessage;
          costUsd = resultMsg.total_cost_usd ?? 0;
          if (resultMsg.result) {
            resultText = resultMsg.result;
          }
        }
      });

      // Auto-approve all tool uses (headless mode)
      proc.on('control_request', (msg: any) => {
        if (msg.request?.subtype === 'can_use_tool') {
          proc.sendControlResponse({
            type: 'control_response',
            request_id: msg.request_id,
            response: { behavior: 'allow' },
          });
        } else if (msg.request?.subtype === 'initialize') {
          // Respond to initialize handshake
          proc.sendControlResponse({
            type: 'control_response',
            request_id: msg.request_id,
            response: { acknowledged: true },
          });
        }
      });

      proc.on('error', (err: Error) => {
        if (!finished) {
          finished = true;
          // Safety: try to abort merge
          this.abortMergeIfNeeded().finally(() => {
            resolve({ branch, success: false, hadConflicts, error: err.message, costUsd });
          });
        }
      });

      proc.on('exit', (code: number | null) => {
        if (!finished) {
          finished = true;
          const success = resultText.includes('MERGE_OK') || (code === 0 && !resultText.includes('MERGE_FAILED'));
          const failed = resultText.includes('MERGE_FAILED');

          if (failed) {
            // Extract failure reason from MERGE_FAILED output
            const failMatch = resultText.match(/MERGE_FAILED:\s*(.+)/);
            resolve({
              branch,
              success: false,
              hadConflicts: true,
              error: failMatch?.[1] || 'Merge failed — ambiguous conflict',
              costUsd,
            });
          } else {
            resolve({ branch, success, hadConflicts, costUsd });
          }
        }
      });

      proc.start();
    });
  }

  private async abortMergeIfNeeded(): Promise<void> {
    try {
      // Check if we're in a merge state
      const mergeHeadPath = resolve(this.projectPath, '.git', 'MERGE_HEAD');
      if (existsSync(mergeHeadPath)) {
        await git(['merge', '--abort'], this.projectPath);
        console.log('[merge-agent] Aborted in-progress merge (safety net)');
      }
    } catch {
      // Best effort — don't fail on cleanup
    }
  }
}
