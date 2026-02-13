# Merge Agent

An autonomous agent that discovers completed worktree branches and merges them back into the target branch, using Claude CLI to intelligently resolve conflicts.

## Overview

When running multiple agents in parallel via worktrees, each produces changes on its own branch. The Merge Agent automates the process of integrating those branches back:

1. **Discovers** worktree branches that are ready (committed, not dirty, not already merged)
2. **Sorts** them by commit count (fewest first — less conflict risk)
3. **Merges** each branch sequentially using `git merge --no-ff`
4. **Resolves conflicts** by spawning a Claude CLI process that reads conflicted files, understands both sides, and edits them to combine changes
5. **Reports** structured results with success/failure per branch and total cost

## Architecture

```
MergeAgent (standalone, no server dependencies)
  ├── ClaudeProcess    ← spawns claude CLI, parses NDJSON stream
  ├── git-v2.ts        ← async git operations (status, merge, branch)
  ├── worktree-manager ← lists worktrees via `git worktree list --porcelain`
  ├── EventEmitter     ← progress events for consumers
  └── Does NOT use: AgentRunner, ThreadManager, WSBroker
```

The agent is fully decoupled from the web server. It can run standalone from the command line or be invoked by the automation scheduler.

## Quick Start

### Standalone (CLI)

```bash
bun run packages/server/src/scripts/test-merge-agent.ts <project-path> [target-branch] [model]
```

**Arguments:**

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `project-path` | Yes | — | Absolute path to the git repository |
| `target-branch` | No | auto-detect (`main`/`master`) | Branch to merge into |
| `model` | No | `sonnet` | Claude model: `sonnet`, `opus`, or `haiku` |

**Examples:**

```bash
# Auto-detect target branch, use sonnet
bun run packages/server/src/scripts/test-merge-agent.ts /home/user/my-project

# Merge into main using opus
bun run packages/server/src/scripts/test-merge-agent.ts /home/user/my-project main opus

# Merge into develop using haiku (cheapest)
bun run packages/server/src/scripts/test-merge-agent.ts /home/user/my-project develop haiku
```

### Programmatic

```typescript
import { MergeAgent } from './services/merge-agent.js';

const agent = new MergeAgent({
  projectPath: '/path/to/repo',
  targetBranch: 'main',
  model: 'sonnet',
});

// Listen to events
agent.on('merge:branch-done', (result) => {
  console.log(`${result.branch}: ${result.success ? 'OK' : 'FAILED'}`);
});

// Run full cycle
const result = await agent.run();
console.log(`Merged ${result.results.length} branches, cost: $${result.totalCostUsd.toFixed(4)}`);
```

### Via Automation Scheduler

Create an automation with `mode: 'merge'` in the UI or API. The scheduler will invoke the Merge Agent on the configured cron schedule.

```json
{
  "projectId": "abc123",
  "name": "Auto-merge worktrees",
  "prompt": "unused for merge mode",
  "schedule": "0 */6 * * *",
  "model": "sonnet",
  "mode": "merge"
}
```

The `baseBranch` field on the automation determines the target branch. If not set, the agent auto-detects from `main`/`master`/`develop`.

## API Reference

### `MergeAgentOptions`

```typescript
interface MergeAgentOptions {
  projectPath: string;        // Path to the git repository (required)
  targetBranch?: string;      // Branch to merge into (auto-detected if omitted)
  model?: ClaudeModel;        // 'sonnet' | 'opus' | 'haiku' (default: 'sonnet')
  maxTurnsPerMerge?: number;  // Max Claude turns per branch (default: 50)
  branches?: string[];        // Specific branches to merge (auto-discovers if omitted)
}
```

### Methods

#### `discoverBranches(): Promise<BranchInfo[]>`

Scans all worktrees and returns branches eligible for merge:
- Excludes the main worktree and the target branch itself
- Filters out dirty worktrees (uncommitted changes)
- Filters out already-merged branches
- Filters out clean branches (no commits ahead)
- Sorts by commit count ascending

```typescript
interface BranchInfo {
  branch: string;        // Branch name
  worktreePath: string;  // Filesystem path to the worktree
  status: GitSyncState;  // 'unpushed' | 'pushed'
  commitCount: number;   // Commits ahead of target
}
```

#### `mergeBranch(branch: string): Promise<MergeResult>`

Merges a single branch into the target. Pre-checks:
1. Working tree must be clean (no uncommitted changes)
2. No `index.lock` file (no concurrent git operations)

Then spawns a `ClaudeProcess` with the merge prompt and monitors until completion.

```typescript
interface MergeResult {
  branch: string;       // Branch that was merged
  success: boolean;     // Whether the merge succeeded
  hadConflicts: boolean // Whether conflicts were encountered
  error?: string;       // Error message if failed
  costUsd?: number;     // Claude API cost for this merge
}
```

#### `run(): Promise<MergeRunResult>`

Full merge cycle: discovers branches, then merges each one sequentially. Stops on the first failure to avoid cascading issues.

```typescript
interface MergeRunResult {
  targetBranch: string;     // Branch that was merged into
  results: MergeResult[];   // Per-branch results
  totalCostUsd: number;     // Total Claude API cost
}
```

### Events

The agent extends `EventEmitter` and emits the following events:

| Event | Payload | When |
|-------|---------|------|
| `merge:start` | `{ branches: BranchInfo[], targetBranch: string }` | Before starting the merge cycle |
| `merge:branch-start` | `{ branch: string, target: string }` | Before merging each branch |
| `merge:progress` | `{ branch: string, message: string }` | Claude produces text output during merge |
| `merge:branch-done` | `MergeResult` | After each branch merge completes or fails |
| `merge:aborted` | `{ branch: string, reason: string }` | When a merge fails and the cycle stops |
| `merge:complete` | `MergeRunResult` | After the entire cycle finishes |

**Example:**

```typescript
agent.on('merge:start', ({ branches, targetBranch }) => {
  console.log(`Merging ${branches.length} branches into ${targetBranch}`);
});

agent.on('merge:progress', ({ branch, message }) => {
  console.log(`[${branch}] ${message}`);
});

agent.on('merge:branch-done', (result) => {
  if (!result.success) {
    console.error(`Failed to merge ${result.branch}: ${result.error}`);
  }
});
```

## How Conflict Resolution Works

When `git merge --no-ff` produces conflicts, Claude:

1. Runs `git status` to identify conflicted files
2. Uses the **Read** tool to read each file and find `<<<<<<<` / `=======` / `>>>>>>>` markers
3. Analyzes both sides of the conflict to understand intent
4. Uses the **Edit** tool to combine both changes and remove all markers
5. Runs `git add` for each resolved file
6. Runs `git commit --no-edit` to complete the merge

If a conflict is ambiguous and cannot be resolved logically:

1. Claude runs `git merge --abort` to restore a clean state
2. Outputs `MERGE_FAILED: Ambiguous conflict in [filename] — [reason]`
3. Exits without asking for user input (headless-safe)

## Safety Mechanisms

| Mechanism | What it does |
|-----------|-------------|
| **Clean tree check** | Verifies `git status --porcelain` is empty before starting |
| **index.lock check** | Refuses to start if another git operation is in progress |
| **try/finally abort** | If Claude crashes mid-merge, `git merge --abort` restores the repo |
| **MERGE_HEAD detection** | Checks `.git/MERGE_HEAD` to detect stuck merge states |
| **Sequential merging** | Merges one branch at a time — stops on first failure |
| **No push** | The agent never pushes to remote — you decide when to push |
| **Headless prompt** | Claude is instructed to never ask for input; abort on ambiguity |
| **Allowed tools whitelist** | Only `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep` — no web access or task spawning |

## File Structure

```
packages/server/src/
├── services/
│   └── merge-agent.ts           # MergeAgent class (core)
├── scripts/
│   └── test-merge-agent.ts      # Standalone CLI test script
└── ...

packages/shared/src/
└── types.ts                     # MergeProgress type

packages/server/src/
├── services/
│   └── automation-scheduler.ts  # Integration: triggerMergeRun()
└── validation/
    └── schemas.ts               # automationModeSchema: 'default' | 'merge'
```

## Configuration for Automation

To set up periodic merge checking via the existing automation system:

1. Navigate to **Settings > Automations** in the UI
2. Create a new automation with:
   - **Name**: e.g., "Auto-merge worktrees"
   - **Schedule**: cron expression (e.g., `*/30 * * * *` for every 30 minutes)
   - **Mode**: `merge`
   - **Model**: `sonnet` (recommended for cost/quality balance) or `opus` (for complex conflicts)
   - **Base Branch**: the target branch (e.g., `main`) — leave empty to auto-detect

The automation scheduler will invoke `MergeAgent.run()` on each trigger. If no branches are ready, the agent completes immediately with no cost.

## Cost Considerations

Each branch merge spawns a separate Claude CLI session. Cost depends on:
- **No conflicts**: ~$0.01-0.03 (just git commands)
- **Simple conflicts**: ~$0.05-0.15 (read + edit files)
- **Complex conflicts**: ~$0.20-0.50 (multiple files, analysis)

Use `haiku` for simple merges and `sonnet`/`opus` for repos with complex conflict potential.

## Limitations

- **Headless only** — The agent cannot ask for human input. If a conflict is truly ambiguous, it aborts the merge for that branch.
- **Shared .git directory** — Git worktrees share the `.git` dir. The agent checks for `index.lock` but cannot prevent all race conditions if other agents run git ops simultaneously.
- **No push** — The agent merges locally but never pushes. This is intentional for safety.
- **Sequential** — Branches are merged one at a time. This is necessary because each merge changes the target branch state.

## Future Enhancements

- **Interactive mode**: When invoked from the UI (as a thread), use `AskUserQuestion` to pause and consult the user on ambiguous conflicts instead of aborting.
- **Worktree cleanup**: Optionally remove worktrees and delete branches after successful merge.
- **Dry-run mode**: Discover and report which branches would be merged without actually merging.
- **UI integration**: Show merge progress in the sidebar with a dedicated merge thread view.
