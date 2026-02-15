/**
 * Build the prompt that drives the pipeline Claude agent.
 *
 * The pipeline agent uses the Task tool to spawn sub-agents in parallel.
 * Each sub-agent runs a specific quality check (tests, security, etc.).
 */

import type { PipelineRequest, Tier, AgentName } from './types.js';

const AGENT_DESCRIPTIONS: Record<AgentName, string> = {
  tests: 'Run the test suite. If tests fail, fix the code and re-run until they pass.',
  security: 'Audit the changes for security vulnerabilities (OWASP Top 10, injection, XSS, etc.).',
  architecture: 'Review code architecture: coupling, cohesion, SOLID principles, and patterns.',
  performance: 'Check for performance regressions: N+1 queries, unnecessary re-renders, large allocations.',
  style: 'Verify code style and linting rules. Fix any violations.',
  types: 'Run the type-checker. Fix any type errors introduced by the changes.',
  docs: 'Ensure documentation is up-to-date for any changed public APIs.',
  integration: 'Verify integration between changed modules. Check imports and contracts.',
};

export function buildPipelinePrompt(
  request: PipelineRequest,
  tier: Tier,
  tierAgents: Record<Tier, AgentName[]>,
  maxCorrections: number,
  pipelinePrefix: string,
  hasBrowserTools?: boolean,
): string {
  const agents = request.config?.agents ?? tierAgents[tier];
  const branch = request.branch;
  const baseBranch = request.base_branch ?? 'main';

  const agentInstructions = agents
    .map((name) => `- **${name}**: ${AGENT_DESCRIPTIONS[name]}`)
    .join('\n');

  const browserSection = hasBrowserTools ? `

## Browser Tools Available
The application is running in a container. You have access to browser automation tools via MCP:
- \`cdp_navigate\` — Navigate the browser to a URL
- \`cdp_screenshot\` — Take a screenshot of the current page (returns PNG image)
- \`cdp_get_dom\` — Get the HTML/DOM of the page or a specific CSS selector

Use these tools for E2E testing, accessibility checks, visual verification, and performance inspection.
` : '';

  return `You are a pipeline orchestrator agent. Your job is to run quality checks on a branch and auto-correct issues.

## Context
- **Branch under review**: \`${branch}\`
- **Base branch**: \`${baseBranch}\`
- **Tier**: ${tier} (${agents.length} agents)
- **Working directory**: \`${request.worktree_path}\`

## Instructions

1. First, create a pipeline branch: \`git checkout -b ${pipelinePrefix}${branch}\` from \`${branch}\`.
2. Launch the following quality agents **in parallel** using the Task tool:

${agentInstructions}

3. Collect results from all agents.
4. If any agent found issues that need fixing:
   - Apply the fixes.
   - Re-run the failing agents to verify the fixes.
   - Repeat up to ${maxCorrections} correction cycles.
5. Once all agents pass (or max corrections reached):
   - Commit any fixes with a descriptive message.
   - Report a summary of all findings and fixes.

## Important
- Do NOT re-plan or restart — execute the agents immediately.
- Each agent task should be self-contained with clear instructions.
- Report progress as you go.
- If an agent fails catastrophically (crash, not a code issue), note it and continue with others.
${browserSection}`;
}
