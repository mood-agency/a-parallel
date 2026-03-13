/**
 * Shared column definitions for all database tables.
 *
 * These plain objects describe the column configuration for each table.
 * The dialect-specific schema files (schema.sqlite.ts, schema.pg.ts) consume
 * these to build Drizzle table definitions with the correct builder.
 *
 * This avoids duplicating column names and defaults across SQLite and PostgreSQL.
 */

import {
  DEFAULT_FOLLOW_UP_MODE,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  DEFAULT_THREAD_MODE,
  DEFAULT_PERMISSION_MODE,
} from '../models.js';

// Re-export defaults so schema files can reference them without extra imports
export {
  DEFAULT_FOLLOW_UP_MODE,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  DEFAULT_THREAD_MODE,
  DEFAULT_PERMISSION_MODE,
};

// ── Column config types ────────────────────────────────────────
// These describe the shape that both sqliteTable() and pgTable() receive.
// We use plain objects + a builder pattern in each schema file.

export const TABLE_NAMES = {
  projects: 'projects',
  threads: 'threads',
  messages: 'messages',
  startupCommands: 'startup_commands',
  toolCalls: 'tool_calls',
  automations: 'automations',
  automationRuns: 'automation_runs',
  userProfiles: 'user_profiles',
  stageHistory: 'stage_history',
  threadComments: 'thread_comments',
  messageQueue: 'message_queue',
  mcpOauthTokens: 'mcp_oauth_tokens',
  pipelines: 'pipelines',
  pipelineRuns: 'pipeline_runs',
  teamProjects: 'team_projects',
  threadEvents: 'thread_events',
  instanceSettings: 'instance_settings',
  // Server-only tables (multi/team mode)
  runners: 'runners',
  runnerProjectAssignments: 'runner_project_assignments',
  runnerTasks: 'runner_tasks',
  projectMembers: 'project_members',
  inviteLinks: 'invite_links',
} as const;
