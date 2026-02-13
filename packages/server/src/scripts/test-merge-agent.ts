#!/usr/bin/env bun
/**
 * Standalone test script for MergeAgent.
 *
 * Usage:
 *   bun run packages/server/src/scripts/test-merge-agent.ts <project-path> [target-branch] [model]
 *
 * Examples:
 *   bun run packages/server/src/scripts/test-merge-agent.ts /path/to/repo
 *   bun run packages/server/src/scripts/test-merge-agent.ts /path/to/repo main sonnet
 *   bun run packages/server/src/scripts/test-merge-agent.ts /path/to/repo main opus
 */

import { MergeAgent } from '../services/merge-agent.js';
import type { ClaudeModel } from '@a-parallel/shared';

const projectPath = process.argv[2];
const targetBranch = process.argv[3] || undefined;
const model = (process.argv[4] as ClaudeModel) || 'sonnet';

if (!projectPath) {
  console.error('Usage: bun run test-merge-agent.ts <project-path> [target-branch] [model]');
  console.error('');
  console.error('  project-path   Path to the git repository (required)');
  console.error('  target-branch  Branch to merge into (default: auto-detect main/master)');
  console.error('  model          Claude model: sonnet | opus | haiku (default: sonnet)');
  process.exit(1);
}

console.log(`\n[merge-agent] Starting merge agent`);
console.log(`  Project:  ${projectPath}`);
console.log(`  Target:   ${targetBranch || '(auto-detect)'}`);
console.log(`  Model:    ${model}\n`);

const agent = new MergeAgent({
  projectPath,
  targetBranch,
  model,
});

// ── Event Listeners ──────────────────────────────────────

agent.on('merge:start', ({ branches, targetBranch: target }) => {
  if (branches.length === 0) {
    console.log('[merge-agent] No branches ready to merge.\n');
    return;
  }
  console.log(`[merge-agent] Found ${branches.length} branch(es) to merge into '${target}':`);
  for (const b of branches) {
    console.log(`  - ${b.branch} (${b.commitCount} commit(s) ahead, status: ${b.status})`);
  }
  console.log('');
});

agent.on('merge:branch-start', ({ branch, target }) => {
  console.log(`[merge-agent] Merging '${branch}' → '${target}'...`);
});

agent.on('merge:progress', ({ branch, message }) => {
  // Truncate long messages for readability
  const truncated = message.length > 200 ? message.slice(0, 200) + '...' : message;
  console.log(`  [${branch}] ${truncated}`);
});

agent.on('merge:branch-done', (result) => {
  const status = result.success ? 'OK' : 'FAILED';
  const conflicts = result.hadConflicts ? ' (had conflicts)' : '';
  const cost = result.costUsd ? ` [$${result.costUsd.toFixed(4)}]` : '';
  const error = result.error ? ` — ${result.error}` : '';
  console.log(`[merge-agent] ${result.branch}: ${status}${conflicts}${cost}${error}\n`);
});

agent.on('merge:aborted', ({ branch, reason }) => {
  console.error(`[merge-agent] Aborted at '${branch}': ${reason}\n`);
});

agent.on('merge:complete', ({ results, totalCostUsd }) => {
  console.log('─'.repeat(60));
  console.log('[merge-agent] Summary:');
  const succeeded = results.filter((r: any) => r.success).length;
  const failed = results.filter((r: any) => !r.success).length;
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Total cost: $${totalCostUsd.toFixed(4)}`);
  console.log('─'.repeat(60));
});

// ── Run ──────────────────────────────────────────────────

try {
  // First, show what branches are available
  console.log('[merge-agent] Discovering branches...\n');
  const branches = await agent.discoverBranches();

  if (branches.length === 0) {
    console.log('[merge-agent] No branches ready to merge. Exiting.');
    process.exit(0);
  }

  // Run the full merge cycle
  const result = await agent.run();

  const allSucceeded = result.results.every((r) => r.success);
  process.exit(allSucceeded ? 0 : 1);
} catch (error: any) {
  console.error(`[merge-agent] Fatal error: ${error.message}`);
  process.exit(1);
}
