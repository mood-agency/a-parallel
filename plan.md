# Plan: Rethink `packages/agent` — Autonomous Issue-to-PR Pipeline

## Vision

Transform `packages/agent` from a **quality-checking pipeline** (runs agents on existing code changes) into a **full autonomous orchestrator** that can take issues from the backlog and drive them all the way to a merged PR — like the Composio Agent Orchestrator, but integrated into funny's existing architecture.

The key insight from the blog post: **the orchestrator itself is an AI agent**, not a dashboard or cron job. It reads your backlog, decomposes features, assigns tasks to coding agents, monitors their progress, handles CI failures, routes review comments, and only pings you when human judgment is needed.

## Current State

Today, `packages/agent` is a **quality pipeline microservice** (port 3002):
- Runs parallel quality agents (tests, security, architecture, style, types...) on existing branches
- Has Director + Integrator for merge orchestration
- Has Hatchet workflows: `feature-to-deploy`, `pr-review-loop`, `cleanup`, `doc-gardening`
- Has EventBus, circuit breakers, DLQ, webhook adapters
- The `feature-to-deploy` workflow already goes from prompt → worktree → implement → quality → PR → deploy

**What's missing:**
1. **Issue Tracker integration** — No way to pull issues from GitHub/Linear backlog
2. **Issue decomposition** — No agent that reads an issue, analyzes the codebase, and creates a plan
3. **Session lifecycle** — No concept of a "session" that tracks an issue through its entire lifecycle
4. **Reactions system** — CI failures and review comments aren't automatically routed back (only via Hatchet, which requires external setup)
5. **Backlog processing** — No ability to pick up N issues and process them in parallel
6. **Progress tracking** — No way to see "issue #42 is at step 3/7, waiting for CI"
7. **Escalation** — No automatic escalation when agents get stuck

## Architecture

### New Concepts

#### 1. **Session** (the core unit)
A Session represents one issue being processed end-to-end. It tracks the full lifecycle:

```
issue_picked → planning → implementing → quality_check → pr_created →
ci_running → ci_passed/ci_failed → review_requested → review_passed → merged
```

Each session has:
- `issueNumber` / `issueUrl` — the source issue
- `threadId` — link back to funny thread (for UI visibility)
- `branch` / `worktreePath` — isolated workspace
- `status` — current lifecycle state
- `plan` — the decomposed implementation plan
- `attempts` — retry count for CI/review cycles
- `events[]` — full audit log

#### 2. **Tracker Plugin** (issue source)
Pluggable interface for pulling issues:

```typescript
interface Tracker {
  name: string;
  fetchIssues(filter: IssueFilter): Promise<Issue[]>;
  fetchIssueDetail(id: string): Promise<IssueDetail>;
  addComment(id: string, body: string): Promise<void>;
  updateLabels(id: string, labels: string[]): Promise<void>;
  closeIssue(id: string): Promise<void>;
}
```

Implementations: `GitHubTracker` (first), `LinearTracker` (later).

#### 3. **Reactions** (event-driven responses)
Declarative policies for automatic responses:

```yaml
reactions:
  ci_failed:
    action: respawn_agent
    prompt: "CI failed. Read the logs and fix the issues."
    max_retries: 3

  changes_requested:
    action: respawn_agent
    prompt: "Review comments posted. Address each one."
    max_retries: 2
    escalate_after: 30m

  approved:
    action: notify
    message: "PR approved and ready to merge"

  agent_stuck:
    action: escalate
    after: 15m
    message: "Agent hasn't made progress — needs human review"
```

#### 4. **Orchestrator Agent** (the brain)
An LLM agent that acts as the "project manager":
- Reads the issue + codebase context
- Creates an implementation plan (which files to touch, approach, risks)
- Decides if the issue needs decomposition into sub-tasks
- Monitors session progress and intervenes when agents drift
- Makes the "ship or escalate" decision

### System Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR AGENT                         │
│  (reads backlog, decomposes issues, monitors sessions)       │
└─────────────────────────┬────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ Session 1│   │ Session 2│   │ Session 3│
    │ Issue #42│   │ Issue #58│   │ Issue #61│
    └────┬─────┘   └────┬─────┘   └────┬─────┘
         │              │              │
    ┌────▼─────┐   ┌────▼─────┐   ┌────▼─────┐
    │  Coding  │   │  Coding  │   │  Coding  │
    │  Agent   │   │  Agent   │   │  Agent   │
    │(worktree)│   │(worktree)│   │(worktree)│
    └────┬─────┘   └────┬─────┘   └────┬─────┘
         │              │              │
    ┌────▼─────┐   ┌────▼─────┐   ┌────▼─────┐
    │ Quality  │   │ Quality  │   │ Quality  │
    │ Pipeline │   │ Pipeline │   │ Pipeline │
    └────┬─────┘   └────┬─────┘   └────┬─────┘
         │              │              │
         ▼              ▼              ▼
    PR + CI + Review Loop (self-healing)
```

## Implementation Plan

### Phase 1: Session & Tracker Foundation
**Files to create/modify:**

1. **`packages/agent/src/core/session.ts`** — NEW
   - `Session` class with full lifecycle state machine
   - States: `created → planning → implementing → quality_check → pr_created → ci_running → ci_passed → review → merged | failed | escalated`
   - Serializable to JSON for persistence
   - Event log for audit trail

2. **`packages/agent/src/core/session-store.ts`** — NEW
   - In-memory + file-based persistence (`~/.funny/sessions/`)
   - CRUD operations, query by status/issue
   - Emits events on state transitions

3. **`packages/agent/src/trackers/tracker.ts`** — NEW
   - `Tracker` interface definition
   - `IssueFilter`, `Issue`, `IssueDetail` types

4. **`packages/agent/src/trackers/github-tracker.ts`** — NEW
   - GitHub Issues API integration via `gh` CLI (already available)
   - Fetch issues by label/milestone/assignee
   - Add comments, update labels, close issues
   - Fetch issue body + all comments for full context

5. **`packages/agent/src/config/schema.ts`** — MODIFY
   - Add `tracker` config section (type, repo, labels, auto_assign)
   - Add `reactions` config section
   - Add `sessions` config section (max_parallel, max_retries)
   - Add `orchestrator` config section (model, auto_decompose)

### Phase 2: Reactions System
**Files to create/modify:**

6. **`packages/agent/src/core/reactions.ts`** — NEW
   - `ReactionEngine` class
   - Declarative reaction definitions loaded from config
   - Listens to EventBus events (ci_failed, changes_requested, approved, agent_stuck)
   - Executes actions: `respawn_agent`, `notify`, `escalate`, `auto_merge`
   - Retry budgets per session
   - Escalation timers

7. **`packages/agent/src/routes/webhooks.ts`** — MODIFY
   - Add `check_run` / `check_suite` event handling (CI status)
   - When CI fails on a session's PR → emit `ci.failed` event → Reactions pick it up
   - When CI passes → emit `ci.passed` → advance session state

### Phase 3: Orchestrator Agent & Issue-to-PR Workflow
**Files to create/modify:**

8. **`packages/agent/src/core/orchestrator-agent.ts`** — NEW
   - The "brain" — an LLM agent that manages the overall flow
   - `planIssue(issue)` — reads issue + codebase, produces implementation plan
   - `decomposeIssue(issue)` — splits into sub-tasks if complex
   - `reviewProgress(session)` — checks if agent is on track
   - Uses AgentExecutor with specialized system prompt + tools (read, glob, grep, bash)

9. **`packages/agent/src/hatchet/workflows/issue-to-pr.ts`** — NEW
   - **Main workflow** that replaces/extends `feature-to-deploy`
   - Steps:
     1. `fetch-issue` — Pull issue details from tracker
     2. `plan-issue` — Orchestrator agent creates implementation plan
     3. `create-session` — Create Session + worktree + thread in funny
     4. `implement` — Coding agent executes the plan (via funny thread or direct AgentExecutor)
     5. `quality-check` — Run quality pipeline (existing)
     6. `create-pr` — Push + create PR, link to issue (`Closes #N`)
     7. `wait-for-ci` — Durable wait for CI result (reactions handle failures)
     8. `wait-for-review` — Durable wait for review (reactions handle feedback)
     9. `merge-and-close` — Squash merge + close issue + cleanup

10. **`packages/agent/src/hatchet/workflows/backlog-processor.ts`** — NEW
    - Scheduled workflow that runs periodically
    - Fetches open issues matching configured labels/filters
    - Prioritizes by labels, age, dependencies
    - Spawns `issue-to-pr` workflows for top N issues (respecting max_parallel)
    - Skips issues already in active sessions

### Phase 4: Integration with Funny Server (UI Visibility)
**Files to modify:**

11. **`packages/agent/src/routes/sessions.ts`** — NEW
    - REST API for session management:
      - `GET /sessions` — list all sessions with status
      - `GET /sessions/:id` — session detail with events
      - `POST /sessions/start` — manually start session for an issue
      - `POST /sessions/:id/escalate` — manual escalation
      - `DELETE /sessions/:id` — cancel session

12. **`packages/agent/src/routes/pipeline.ts`** — MODIFY
    - Add endpoint to trigger issue-to-pr from the UI
    - `POST /pipeline/issue` — accepts `{ issueNumber, projectPath, config }`

13. **`packages/agent/src/index.ts`** — MODIFY
    - Wire up SessionStore, ReactionEngine, Tracker
    - Register new routes
    - Connect reactions to EventBus

### Phase 5: Config & Glue
**Files to create/modify:**

14. **`packages/agent/src/config/defaults.ts`** — MODIFY
    - Add defaults for tracker, reactions, sessions, orchestrator config

15. **`packages/agent/README.md`** — MODIFY
    - Update documentation with new issue-to-pr flow
    - Configuration examples

## Config Example (`.pipeline/config.yaml`)

```yaml
# Existing config stays the same, plus:

tracker:
  type: github              # github | linear
  repo: owner/repo           # auto-detected from git remote if not set
  labels:
    - agent-ready            # only pick up issues with this label
  exclude_labels:
    - wontfix
    - blocked
  max_parallel: 5            # max concurrent sessions

orchestrator:
  model: claude-sonnet-4-5-20250929
  provider: funny-api-acp
  auto_decompose: true       # auto-split complex issues
  plan_approval: false       # require human approval of plan before implementing

sessions:
  max_retries_ci: 3          # max CI fix attempts
  max_retries_review: 2      # max review feedback cycles
  escalate_after_min: 30     # escalate if stuck for N minutes
  auto_merge: false          # auto-merge when approved + CI green
  persist_path: ~/.funny/sessions

reactions:
  ci_failed:
    action: respawn_agent
    prompt: "CI failed on this PR. Read the failure logs and fix the issues."
    max_retries: 3

  changes_requested:
    action: respawn_agent
    prompt: "Review comments have been posted. Address each comment and push fixes."
    max_retries: 2
    escalate_after_min: 30

  approved_and_green:
    action: notify
    message: "PR #{prNumber} approved and CI green — ready to merge"

  agent_stuck:
    action: escalate
    message: "Session for issue #{issueNumber} stuck — needs human review"
```

## Key Design Decisions

1. **Sessions are first-class** — Every issue gets a Session that tracks its full lifecycle. This is the missing abstraction.

2. **Reactions are declarative** — Instead of hardcoding what happens on CI failure, reactions are config-driven policies. This makes the system adaptable without code changes.

3. **Orchestrator is an agent, not a script** — The planning step uses an LLM to understand the issue and codebase, not just template matching. This handles the "decompose complex features" case.

4. **Builds on existing infrastructure** — We reuse EventBus, AgentExecutor, QualityPipeline, Integrator, worktrees, and Hatchet. We don't rewrite what works.

5. **Funny threads for visibility** — Each session creates a thread in the funny UI, so you can watch the agent work in real-time. The existing WebSocket infrastructure handles streaming.

6. **Progressive rollout** — Phase 1-2 (Sessions + Reactions) work without Hatchet. Phase 3 (full workflow) benefits from Hatchet but can fall back to in-process orchestration.

## What We Preserve

- All existing quality pipeline functionality (PipelineRunner, QualityPipeline, agent roles)
- Director + Integrator merge orchestration
- EventBus + circuit breakers + DLQ infrastructure
- Existing Hatchet workflows (feature-to-deploy, pr-review-loop, cleanup)
- All API routes (pipeline, director, webhooks, logs)
- Configuration schema (additive changes only)

## Execution Order

I'll implement in this order, each phase building on the last:
1. Session + SessionStore (core abstraction)
2. Tracker interface + GitHubTracker
3. Config schema additions
4. ReactionEngine
5. OrchestratorAgent
6. issue-to-pr Hatchet workflow
7. backlog-processor workflow
8. Sessions REST API
9. Wire everything in index.ts
10. Update webhook routes for CI events
