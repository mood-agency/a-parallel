/**
 * issue-to-pr — Hatchet workflow for autonomous issue processing.
 *
 * Takes a GitHub issue and drives it all the way to a merged PR:
 *   1. fetch-issue — Pull full issue details from tracker
 *   2. plan-issue — Orchestrator agent analyzes codebase + creates plan
 *   3. create-workspace — Create worktree + session
 *   4. implement — Coding agent executes the plan
 *   5. quality-check — Run quality pipeline
 *   6. create-pr — Push + create PR linking to issue
 *   7. wait-for-ci — Durable wait for CI (reactions handle failures)
 *   8. wait-for-review — Durable wait for review (reactions handle feedback)
 *   9. merge-and-close — Squash merge + close issue + cleanup
 */

import type { HatchetClient, DurableContext } from '@hatchet-dev/typescript-sdk/v1';
import { execute } from '@funny/core/git';
import { AgentExecutor, ModelFactory } from '@funny/core/agents';
import type { AgentRole, AgentContext } from '@funny/core/agents';
import type { PipelineRunner } from '../../core/pipeline-runner.js';
import { logger } from '../../infrastructure/logger.js';

// ── Input/Output types ──────────────────────────────────────────

interface IssueToPRInput {
  issueNumber: number;
  projectPath: string;
  repo?: string;
  model?: string;
  provider?: string;
  baseBranch?: string;
  /** Pre-fetched issue context (skips fetch-issue step if provided) */
  issueContext?: string;
  /** Pre-computed plan (skips plan-issue step if provided) */
  plan?: {
    summary: string;
    approach: string;
    files_to_modify: string[];
    files_to_create: string[];
    estimated_complexity: 'small' | 'medium' | 'large';
    risks: string[];
  };
}

interface FetchIssueOutput {
  title: string;
  body: string;
  labels: string[];
  fullContext: string;
}

interface PlanOutput {
  summary: string;
  approach: string;
  files_to_modify: string[];
  files_to_create: string[];
  estimated_complexity: string;
  risks: string[];
}

interface WorkspaceOutput {
  worktreePath: string;
  branch: string;
}

interface ImplementOutput {
  status: string;
  commitCount: number;
}

interface QualityOutput {
  request_id: string;
  status: string;
}

interface PROutput {
  prNumber: number;
  prUrl: string;
}

interface CIOutput {
  passed: boolean;
}

interface ReviewOutput {
  approved: boolean;
}

interface MergeOutput {
  merged: boolean;
  mergedAt: string;
}

type WorkflowOutput = {
  'fetch-issue': FetchIssueOutput;
  'plan-issue': PlanOutput;
  'create-workspace': WorkspaceOutput;
  'implement': ImplementOutput;
  'quality-check': QualityOutput;
  'create-pr': PROutput;
  'wait-for-ci': CIOutput;
  'wait-for-review': ReviewOutput;
  'merge-and-close': MergeOutput;
};

// ── Workflow registration ───────────────────────────────────────

export function registerIssueToPRWorkflow(hatchet: HatchetClient, runner: PipelineRunner) {
  const workflow = hatchet.workflow<IssueToPRInput, WorkflowOutput>({
    name: 'issue-to-pr',
  });

  // Step 1: Fetch issue details from GitHub
  const fetchIssue = workflow.task({
    name: 'fetch-issue',
    executionTimeout: '5m',
    retries: 2,
    fn: async (input) => {
      // If context was pre-fetched, skip
      if (input.issueContext) {
        return {
          title: `Issue #${input.issueNumber}`,
          body: input.issueContext,
          labels: [],
          fullContext: input.issueContext,
        } as FetchIssueOutput;
      }

      const repo = input.repo ?? '';
      const repoArgs = repo ? ['--repo', repo] : [];

      const { stdout } = await execute(
        'gh', ['issue', 'view', String(input.issueNumber), ...repoArgs, '--json',
          'title,body,labels,comments'],
        { cwd: input.projectPath },
      );

      const data = JSON.parse(stdout);
      const labels = (data.labels ?? []).map((l: any) => l.name);
      const comments = (data.comments ?? [])
        .map((c: any) => `### @${c.author?.login ?? 'unknown'}\n${c.body}`)
        .join('\n\n');

      const fullContext = [
        `# Issue #${input.issueNumber}: ${data.title}`,
        '',
        data.body ?? '(no description)',
        comments ? `\n## Comments\n\n${comments}` : '',
      ].join('\n');

      return {
        title: data.title,
        body: data.body ?? '',
        labels,
        fullContext,
      } as FetchIssueOutput;
    },
  });

  // Step 2: Plan the implementation using an LLM agent
  const planIssue = workflow.task({
    name: 'plan-issue',
    parents: [fetchIssue],
    executionTimeout: '15m',
    retries: 1,
    fn: async (input, ctx) => {
      // If plan was pre-computed, skip
      if (input.plan) {
        return input.plan as PlanOutput;
      }

      const issueData = await ctx.parentOutput(fetchIssue);

      const role: AgentRole = {
        name: 'planner',
        systemPrompt: `You are a senior software architect analyzing a GitHub issue to create an implementation plan.

## Issue #${input.issueNumber}: ${issueData.title}

${issueData.fullContext}

## Your Task

Analyze this issue and the codebase to create a detailed implementation plan.

1. Explore the codebase — Use read, glob, and grep to understand the existing architecture
2. Identify relevant files — Find files that need to be modified or created
3. Design the approach — Determine the best way to implement this
4. Assess complexity — small (≤3 files), medium (4-10 files), large (10+ files)

Output your plan as JSON:

\`\`\`json
{
  "summary": "One-line summary",
  "approach": "Detailed approach (2-5 sentences)",
  "files_to_modify": ["path/to/file.ts"],
  "files_to_create": ["path/to/new.ts"],
  "estimated_complexity": "small" | "medium" | "large",
  "risks": ["Risk description"]
}
\`\`\`

Working directory: ${input.projectPath}`,
        model: input.model ?? 'claude-sonnet-4-5-20250929',
        provider: input.provider ?? 'funny-api-acp',
        tools: [],
        maxTurns: 30,
      };

      const context: AgentContext = {
        branch: input.baseBranch ?? 'main',
        worktreePath: input.projectPath,
        tier: 'medium',
        diffStats: { files_changed: 0, lines_added: 0, lines_deleted: 0, changed_files: [] },
        previousResults: [],
        baseBranch: input.baseBranch ?? 'main',
      };

      const modelFactory = new ModelFactory();
      const resolved = modelFactory.resolve(role.provider, role.model);
      const executor = new AgentExecutor(resolved.baseURL, resolved.modelId, resolved.apiKey);
      const result = await executor.execute(role, context);

      // Parse plan from output
      const finding = result.findings[0];
      if (finding?.description) {
        const jsonMatch = finding.description.match(/```json\s*([\s\S]*?)\s*```/)
          ?? finding.description.match(/(\{[\s\S]*"summary"[\s\S]*\})/);
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[1] ?? jsonMatch[0]) as PlanOutput;
          } catch { /* fall through */ }
        }
      }

      return {
        summary: 'Auto-generated plan',
        approach: 'Implement based on issue description',
        files_to_modify: [],
        files_to_create: [],
        estimated_complexity: 'medium',
        risks: ['Plan could not be parsed from agent output'],
      } as PlanOutput;
    },
  });

  // Step 3: Create worktree for isolated work
  const createWorkspace = workflow.task({
    name: 'create-workspace',
    parents: [planIssue],
    executionTimeout: '2m',
    fn: async (input) => {
      const baseBranch = input.baseBranch ?? 'main';
      const branch = `issue/${input.issueNumber}`;
      const safeBranch = branch.replace(/\//g, '-');
      const worktreePath = `${input.projectPath}/.funny-worktrees/${safeBranch}`;

      await execute('git', ['fetch', 'origin', baseBranch], {
        cwd: input.projectPath,
        reject: false,
      });

      await execute('git', ['worktree', 'add', '-b', branch, worktreePath, `origin/${baseBranch}`], {
        cwd: input.projectPath,
      });

      logger.info({ branch, worktreePath }, 'Worktree created for issue');
      return { worktreePath, branch } as WorkspaceOutput;
    },
  });

  // Step 4: Implement the feature
  const implement = workflow.task({
    name: 'implement',
    parents: [createWorkspace, planIssue, fetchIssue],
    executionTimeout: '45m',
    retries: 1,
    fn: async (input, ctx) => {
      const workspace = await ctx.parentOutput(createWorkspace);
      const plan = await ctx.parentOutput(planIssue);
      const issueData = await ctx.parentOutput(fetchIssue);

      const role: AgentRole = {
        name: 'implementer',
        systemPrompt: `You are a senior software engineer implementing a feature.

## Issue #${input.issueNumber}: ${issueData.title}

${issueData.fullContext}

## Implementation Plan

**Summary:** ${plan.summary}
**Approach:** ${plan.approach}
**Files to modify:** ${plan.files_to_modify.join(', ') || '(none specified)'}
**Files to create:** ${plan.files_to_create.join(', ') || '(none)'}

${plan.risks.length > 0 ? `**Risks:** ${plan.risks.join('; ')}` : ''}

## Instructions

1. Read existing code to understand patterns
2. Implement changes according to the plan
3. Follow existing code style
4. Commit with: \`feat/fix(scope): description (Closes #${input.issueNumber})\`

Stay on the current branch. Do NOT create new branches.

When finished, output:
\`\`\`json
{"status": "passed", "findings": [{"severity": "info", "description": "Summary", "fix_applied": true}], "fixes_applied": 1}
\`\`\``,
        model: input.model ?? 'claude-sonnet-4-5-20250929',
        provider: input.provider ?? 'funny-api-acp',
        tools: [],
        maxTurns: 200,
      };

      const context: AgentContext = {
        branch: workspace.branch,
        worktreePath: workspace.worktreePath,
        tier: (plan.estimated_complexity as any) ?? 'medium',
        diffStats: { files_changed: 0, lines_added: 0, lines_deleted: 0, changed_files: [] },
        previousResults: [],
        baseBranch: input.baseBranch ?? 'main',
      };

      const modelFactory = new ModelFactory();
      const resolved = modelFactory.resolve(role.provider, role.model);
      const executor = new AgentExecutor(resolved.baseURL, resolved.modelId, resolved.apiKey);
      await executor.execute(role, context);

      // Count commits on branch
      const { stdout: commitLog } = await execute(
        'git', ['rev-list', '--count', `origin/${input.baseBranch ?? 'main'}..HEAD`],
        { cwd: workspace.worktreePath, reject: false },
      );

      return {
        status: 'completed',
        commitCount: parseInt(commitLog.trim(), 10) || 0,
      } as ImplementOutput;
    },
  });

  // Step 5: Quality check (optional — trigger existing pipeline directly)
  const qualityCheck = workflow.task({
    name: 'quality-check',
    parents: [implement],
    executionTimeout: '60m',
    fn: async (input, ctx) => {
      const workspace = await ctx.parentOutput(createWorkspace);
      const requestId = `issue-${input.issueNumber}-${Date.now()}`;

      // Run pipeline directly (fire-and-forget — it publishes events on completion)
      runner.run({
        request_id: requestId,
        branch: workspace.branch,
        worktree_path: workspace.worktreePath,
        base_branch: input.baseBranch ?? 'main',
        config: { skip_merge: true },
      }).catch((err) => {
        logger.error({ requestId, err: err.message }, 'Quality pipeline run failed');
      });

      // Poll runner status for completion
      let delay = 5_000;
      for (let i = 0; i < 360; i++) {
        if (ctx.cancelled) throw new Error('Cancelled');

        const state = runner.getStatus(requestId);
        if (state) {
          if (state.status === 'approved') {
            return { request_id: requestId, status: 'passed' } as QualityOutput;
          }
          if (state.status === 'failed' || state.status === 'error') {
            return { request_id: requestId, status: 'failed' } as QualityOutput;
          }
        }

        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 1.5, 30_000);
      }

      return { request_id: requestId, status: 'timeout' } as QualityOutput;
    },
  });

  // Step 6: Create PR
  const createPR = workflow.task({
    name: 'create-pr',
    parents: [qualityCheck, fetchIssue, planIssue],
    executionTimeout: '5m',
    retries: 2,
    fn: async (input, ctx) => {
      const workspace = await ctx.parentOutput(createWorkspace);
      const issueData = await ctx.parentOutput(fetchIssue);
      const plan = await ctx.parentOutput(planIssue);

      // Push branch
      await execute('git', ['push', '-u', 'origin', workspace.branch], {
        cwd: workspace.worktreePath,
      });

      // Create PR
      const body = [
        `## Summary`,
        '',
        plan.summary,
        '',
        `## Approach`,
        '',
        plan.approach,
        '',
        `Closes #${input.issueNumber}`,
        '',
        `---`,
        `*Autonomously generated by funny agent*`,
      ].join('\n');

      const { stdout: prJson } = await execute(
        'gh', ['pr', 'create',
          '--head', workspace.branch,
          '--base', input.baseBranch ?? 'main',
          '--title', `${issueData.title} (#${input.issueNumber})`,
          '--body', body,
          '--json', 'number,url',
        ],
        { cwd: workspace.worktreePath },
      );

      const pr = JSON.parse(prJson);
      logger.info({ prNumber: pr.number, issueNumber: input.issueNumber }, 'PR created for issue');

      return { prNumber: pr.number, prUrl: pr.url } as PROutput;
    },
  });

  // Step 7: Wait for CI (durable)
  const waitForCI = workflow.durableTask({
    name: 'wait-for-ci',
    parents: [createPR],
    executionTimeout: '24h',
    fn: async (input, ctx: DurableContext<IssueToPRInput>) => {
      const result = await ctx.waitFor({
        eventKey: `ci.completed.issue-${input.issueNumber}`,
      });

      return { passed: (result as any)?.passed === true } as CIOutput;
    },
  });

  // Step 8: Wait for review (durable)
  const waitForReview = workflow.durableTask({
    name: 'wait-for-review',
    parents: [waitForCI],
    executionTimeout: '168h', // 7 days
    fn: async (input, ctx: DurableContext<IssueToPRInput>) => {
      const ciResult = await ctx.parentOutput(waitForCI);
      if (!ciResult.passed) {
        return { approved: false } as ReviewOutput;
      }

      const result = await ctx.waitFor({
        eventKey: `pr.approved.issue-${input.issueNumber}`,
      });

      return { approved: true } as ReviewOutput;
    },
  });

  // Step 9: Merge and close
  workflow.task({
    name: 'merge-and-close',
    parents: [waitForReview],
    executionTimeout: '10m',
    retries: 2,
    fn: async (input, ctx) => {
      const reviewResult = await ctx.parentOutput(waitForReview);
      const prResult = await ctx.parentOutput(createPR);

      if (!reviewResult.approved) {
        logger.warn({ issueNumber: input.issueNumber }, 'Review not approved — skipping merge');
        return { merged: false, mergedAt: '' } as MergeOutput;
      }

      // Squash merge
      await execute(
        'gh', ['pr', 'merge', String(prResult.prNumber), '--squash', '--delete-branch'],
        { cwd: input.projectPath },
      );

      // Close the issue if not auto-closed by "Closes #N"
      await execute(
        'gh', ['issue', 'close', String(input.issueNumber), '--comment',
          `Resolved via PR #${prResult.prNumber}`],
        { cwd: input.projectPath, reject: false },
      );

      // Cleanup worktree
      const workspace = await ctx.parentOutput(createWorkspace);
      await execute('git', ['worktree', 'remove', workspace.worktreePath, '--force'], {
        cwd: input.projectPath,
        reject: false,
      });

      logger.info({ issueNumber: input.issueNumber, prNumber: prResult.prNumber }, 'Issue merged and closed');

      return { merged: true, mergedAt: new Date().toISOString() } as MergeOutput;
    },
  });

  return workflow;
}
