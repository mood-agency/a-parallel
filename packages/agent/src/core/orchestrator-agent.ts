/**
 * OrchestratorAgent — the "brain" that plans issue implementation.
 *
 * An LLM agent that:
 * - Reads an issue + codebase context
 * - Creates an implementation plan (files to modify, approach, risks)
 * - Decides if the issue needs decomposition into sub-tasks
 *
 * Uses AgentExecutor with read-only tools (read, glob, grep, bash)
 * to explore the codebase before producing a plan.
 */

import { AgentExecutor, ModelFactory } from '@funny/core/agents';
import type { AgentRole, AgentContext } from '@funny/core/agents';
import type { IssueDetail } from '../trackers/tracker.js';
import type { ImplementationPlan } from './session.js';
import type { PipelineServiceConfig } from '../config/schema.js';
import { logger } from '../infrastructure/logger.js';

// ── System prompt ───────────────────────────────────────────────

function buildPlanningPrompt(issue: IssueDetail, projectPath: string): string {
  return `You are a senior software architect analyzing a GitHub issue to create an implementation plan.

## Issue #${issue.number}: ${issue.title}

${issue.fullContext}

## Your Task

Analyze this issue and the codebase to create a detailed implementation plan.

1. **Explore the codebase** — Use read, glob, and grep to understand the existing architecture
2. **Identify relevant files** — Find files that need to be modified or created
3. **Design the approach** — Determine the best way to implement this
4. **Assess complexity** — Estimate if this is small, medium, or large
5. **Identify risks** — What could go wrong? Are there edge cases?

## Output Format

After exploring, output your plan as a JSON block:

\`\`\`json
{
  "summary": "One-line summary of what needs to be done",
  "approach": "Detailed description of the implementation approach (2-5 sentences)",
  "files_to_modify": ["path/to/file1.ts", "path/to/file2.ts"],
  "files_to_create": ["path/to/new-file.ts"],
  "estimated_complexity": "small" | "medium" | "large",
  "risks": ["Risk 1", "Risk 2"],
  "sub_tasks": ["Sub-task 1 (optional)", "Sub-task 2 (optional)"]
}
\`\`\`

## Guidelines

- Be specific about which files to modify — don't guess, use grep/glob to verify
- The approach should be concrete enough for another agent to implement
- Mark complexity as:
  - **small**: ≤3 files, straightforward change
  - **medium**: 4-10 files, requires understanding existing patterns
  - **large**: 10+ files or architectural changes
- Only include sub_tasks if the issue genuinely needs decomposition
- Working directory: ${projectPath}`;
}

// ── Implementing prompt ─────────────────────────────────────────

function buildImplementingPrompt(
  issue: IssueDetail,
  plan: ImplementationPlan,
): string {
  return `You are a senior software engineer implementing a feature based on a pre-approved plan.

## Issue #${issue.number}: ${issue.title}

${issue.fullContext}

## Implementation Plan

**Summary:** ${plan.summary}

**Approach:** ${plan.approach}

**Files to modify:** ${plan.files_to_modify.join(', ')}
**Files to create:** ${plan.files_to_create.join(', ')}
**Estimated complexity:** ${plan.estimated_complexity}

${plan.risks.length > 0 ? `**Risks to watch for:**\n${plan.risks.map((r) => `- ${r}`).join('\n')}` : ''}

## Instructions

1. Read the existing code to understand current patterns
2. Implement the changes according to the plan
3. Follow existing code style and conventions
4. Write clean, well-structured code
5. Commit your changes with a descriptive message referencing the issue:
   \`fix/feat(scope): description (Closes #${issue.number})\`

## Important

- Stay on the current branch — do NOT create new branches
- Make incremental commits for logical chunks of work
- If you encounter something unexpected, adapt the plan sensibly
- If a risk from the plan materializes, handle it gracefully

When finished, output a JSON summary:

\`\`\`json
{
  "status": "passed",
  "findings": [{ "severity": "info", "description": "Implementation summary...", "fix_applied": true }],
  "fixes_applied": 1
}
\`\`\``;
}

// ── OrchestratorAgent ───────────────────────────────────────────

export class OrchestratorAgent {
  constructor(private config: PipelineServiceConfig) {}

  /**
   * Analyze an issue and produce an implementation plan.
   * The agent explores the codebase with read-only tools.
   */
  async planIssue(
    issue: IssueDetail,
    projectPath: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ImplementationPlan> {
    const { orchestrator } = this.config;

    const role: AgentRole = {
      name: 'planner',
      systemPrompt: buildPlanningPrompt(issue, projectPath),
      model: orchestrator.model,
      provider: orchestrator.provider,
      tools: [],
      maxTurns: orchestrator.max_planning_turns,
    };

    const context: AgentContext = {
      branch: 'main',
      worktreePath: projectPath,
      tier: 'medium',
      diffStats: { files_changed: 0, lines_added: 0, lines_deleted: 0, changed_files: [] },
      previousResults: [],
      baseBranch: 'main',
    };

    const modelFactory = new ModelFactory();
    const resolved = modelFactory.resolve(role.provider, role.model);
    const executor = new AgentExecutor(resolved.baseURL, resolved.modelId, resolved.apiKey);
    const result = await executor.execute(role, context, { signal: opts?.signal });

    // Parse the plan from the agent's output
    const plan = this.extractPlan(result);

    logger.info(
      { issueNumber: issue.number, complexity: plan.estimated_complexity, files: plan.files_to_modify.length },
      'Issue plan created',
    );

    return plan;
  }

  /**
   * Implement an issue using a coding agent in the given worktree.
   */
  async implementIssue(
    issue: IssueDetail,
    plan: ImplementationPlan,
    worktreePath: string,
    branch: string,
    opts?: { signal?: AbortSignal },
  ): Promise<{ status: string; findings_count: number }> {
    const { orchestrator } = this.config;

    const role: AgentRole = {
      name: 'implementer',
      systemPrompt: buildImplementingPrompt(issue, plan),
      model: orchestrator.model,
      provider: orchestrator.provider,
      tools: [],
      maxTurns: orchestrator.max_implementing_turns,
    };

    const context: AgentContext = {
      branch,
      worktreePath,
      tier: plan.estimated_complexity,
      diffStats: { files_changed: 0, lines_added: 0, lines_deleted: 0, changed_files: [] },
      previousResults: [],
      baseBranch: 'main',
    };

    const modelFactory = new ModelFactory();
    const resolved = modelFactory.resolve(role.provider, role.model);
    const executor = new AgentExecutor(resolved.baseURL, resolved.modelId, resolved.apiKey);
    const result = await executor.execute(role, context, { signal: opts?.signal });

    logger.info(
      { issueNumber: issue.number, status: result.status, fixes: result.fixes_applied },
      'Issue implementation completed',
    );

    return { status: result.status, findings_count: result.findings.length };
  }

  // ── Plan extraction ───────────────────────────────────────────

  private extractPlan(result: { findings: Array<{ description: string }>; status: string }): ImplementationPlan {
    // Try to find JSON in the agent's output
    for (const finding of result.findings) {
      const plan = this.parsePlanJson(finding.description);
      if (plan) return plan;
    }

    // Fallback: return a generic plan
    logger.warn('Could not parse plan from agent output — using fallback');
    return {
      summary: 'Implementation plan could not be parsed from agent output',
      approach: 'Manual review needed',
      files_to_modify: [],
      files_to_create: [],
      estimated_complexity: 'medium',
      risks: ['Plan extraction failed — may need human guidance'],
    };
  }

  private parsePlanJson(text: string): ImplementationPlan | null {
    try {
      // Try JSON in code block
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
        ?? text.match(/(\{[\s\S]*"summary"[\s\S]*"approach"[\s\S]*\})/);

      if (!jsonMatch) return null;

      const raw = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);

      return {
        summary: raw.summary ?? '',
        approach: raw.approach ?? '',
        files_to_modify: Array.isArray(raw.files_to_modify) ? raw.files_to_modify : [],
        files_to_create: Array.isArray(raw.files_to_create) ? raw.files_to_create : [],
        estimated_complexity: ['small', 'medium', 'large'].includes(raw.estimated_complexity)
          ? raw.estimated_complexity
          : 'medium',
        risks: Array.isArray(raw.risks) ? raw.risks : [],
        sub_tasks: Array.isArray(raw.sub_tasks) ? raw.sub_tasks : undefined,
      };
    } catch {
      return null;
    }
  }
}
