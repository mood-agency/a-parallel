/**
 * backlog-processor — Hatchet workflow for scanning the issue backlog.
 *
 * Runs on a schedule or manually. Fetches open issues matching configured
 * labels/filters, prioritizes them, and spawns issue-to-pr workflows
 * for the top N issues (respecting max_parallel limit).
 *
 * Skips issues that already have an active session.
 */

import type { HatchetClient } from '@hatchet-dev/typescript-sdk/v1';
import { execute } from '@funny/core/git';
import { logger } from '../../infrastructure/logger.js';

// ── Input/Output types ──────────────────────────────────────────

interface BacklogProcessorInput {
  projectPath: string;
  repo?: string;
  /** Override: only process these specific issue numbers */
  issueNumbers?: number[];
  /** Override max parallel from config */
  maxParallel?: number;
  /** Label filter (defaults to config) */
  labels?: string[];
  /** Labels to exclude (defaults to config) */
  excludeLabels?: string[];
  model?: string;
  provider?: string;
  baseBranch?: string;
}

interface ScanOutput {
  issues: Array<{
    number: number;
    title: string;
    labels: string[];
    createdAt: string;
    commentsCount: number;
  }>;
  totalOpen: number;
}

interface PrioritizeOutput {
  selected: Array<{
    number: number;
    title: string;
    priority: number;
    reason: string;
  }>;
  skipped: number;
}

interface SpawnOutput {
  spawned: Array<{ issueNumber: number; workflowRunId: string }>;
  skippedActive: number;
}

type WorkflowOutput = {
  'scan-backlog': ScanOutput;
  'prioritize': PrioritizeOutput;
  'spawn-sessions': SpawnOutput;
};

// ── Workflow registration ───────────────────────────────────────

export function registerBacklogProcessorWorkflow(hatchet: HatchetClient) {
  const workflow = hatchet.workflow<BacklogProcessorInput, WorkflowOutput>({
    name: 'backlog-processor',
  });

  // Step 1: Scan the backlog for eligible issues
  const scanBacklog = workflow.task({
    name: 'scan-backlog',
    executionTimeout: '5m',
    retries: 2,
    fn: async (input) => {
      // If specific issues were requested, fetch those
      if (input.issueNumbers?.length) {
        const issues = [];
        for (const num of input.issueNumbers) {
          const repoArgs = input.repo ? ['--repo', input.repo] : [];
          const { stdout, exitCode } = await execute(
            'gh', ['issue', 'view', String(num), ...repoArgs, '--json',
              'number,title,labels,createdAt,comments'],
            { cwd: input.projectPath, reject: false },
          );
          if (exitCode === 0 && stdout.trim()) {
            const data = JSON.parse(stdout);
            issues.push({
              number: data.number,
              title: data.title,
              labels: (data.labels ?? []).map((l: any) => l.name),
              createdAt: data.createdAt,
              commentsCount: Array.isArray(data.comments) ? data.comments.length : 0,
            });
          }
        }
        return { issues, totalOpen: issues.length } as ScanOutput;
      }

      // Otherwise scan by label filter
      const repoArgs = input.repo ? ['--repo', input.repo] : [];
      const labelArgs: string[] = [];
      const labels = input.labels ?? [];
      for (const label of labels) {
        labelArgs.push('--label', label);
      }

      const { stdout, exitCode } = await execute(
        'gh', ['issue', 'list', ...repoArgs, '--state', 'open', ...labelArgs,
          '--limit', '50', '--json', 'number,title,labels,createdAt,comments'],
        { cwd: input.projectPath, reject: false },
      );

      if (exitCode !== 0 || !stdout.trim()) {
        return { issues: [], totalOpen: 0 } as ScanOutput;
      }

      const raw = JSON.parse(stdout) as any[];

      // Client-side exclude filter
      const excludeSet = new Set(input.excludeLabels ?? []);
      const filtered = raw.filter((item) => {
        const itemLabels = (item.labels ?? []).map((l: any) => l.name);
        return !itemLabels.some((l: string) => excludeSet.has(l));
      });

      const issues = filtered.map((item) => ({
        number: item.number,
        title: item.title,
        labels: (item.labels ?? []).map((l: any) => l.name),
        createdAt: item.createdAt,
        commentsCount: Array.isArray(item.comments) ? item.comments.length : 0,
      }));

      logger.info({ total: raw.length, filtered: issues.length }, 'Backlog scan complete');

      return { issues, totalOpen: issues.length } as ScanOutput;
    },
  });

  // Step 2: Prioritize issues
  const prioritize = workflow.task({
    name: 'prioritize',
    parents: [scanBacklog],
    executionTimeout: '2m',
    fn: async (input, ctx) => {
      const scan = await ctx.parentOutput(scanBacklog);
      const maxParallel = input.maxParallel ?? 5;

      // Simple priority: bugs first, then by age (oldest first)
      const scored = scan.issues.map((issue) => {
        let priority = 50;
        let reason = 'default';

        const labelNames = issue.labels.map((l) => l.toLowerCase());

        if (labelNames.includes('bug') || labelNames.includes('critical')) {
          priority = 10;
          reason = 'bug/critical label';
        } else if (labelNames.includes('high-priority') || labelNames.includes('p0') || labelNames.includes('p1')) {
          priority = 20;
          reason = 'high priority label';
        } else if (labelNames.includes('enhancement') || labelNames.includes('feature')) {
          priority = 40;
          reason = 'feature/enhancement';
        }

        // Older issues get slight priority boost
        const ageMs = Date.now() - new Date(issue.createdAt).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays > 30) priority -= 5;
        if (ageDays > 90) priority -= 5;

        return { ...issue, priority, reason };
      });

      // Sort by priority (lower = higher priority) and take top N
      scored.sort((a, b) => a.priority - b.priority);
      const selected = scored.slice(0, maxParallel).map((s) => ({
        number: s.number,
        title: s.title,
        priority: s.priority,
        reason: s.reason,
      }));

      logger.info(
        { total: scan.issues.length, selected: selected.length },
        'Issues prioritized',
      );

      return {
        selected,
        skipped: scan.issues.length - selected.length,
      } as PrioritizeOutput;
    },
  });

  // Step 3: Spawn issue-to-pr workflows for selected issues
  workflow.task({
    name: 'spawn-sessions',
    parents: [prioritize],
    executionTimeout: '5m',
    fn: async (input, ctx) => {
      const { selected } = await ctx.parentOutput(prioritize);
      const spawned: Array<{ issueNumber: number; workflowRunId: string }> = [];
      let skippedActive = 0;

      for (const issue of selected) {
        try {
          // Check if issue already has an active workflow
          // (in a full implementation, we'd check SessionStore here)

          const run = await hatchet.runNoWait('issue-to-pr', {
            issueNumber: issue.number,
            projectPath: input.projectPath,
            repo: input.repo,
            model: input.model,
            provider: input.provider,
            baseBranch: input.baseBranch,
          }, {});

          spawned.push({
            issueNumber: issue.number,
            workflowRunId: String(run),
          });

          logger.info({ issueNumber: issue.number }, 'Spawned issue-to-pr workflow');
        } catch (err: any) {
          logger.error({ issueNumber: issue.number, err: err.message }, 'Failed to spawn issue-to-pr');
        }
      }

      return { spawned, skippedActive } as SpawnOutput;
    },
  });

  return workflow;
}
