/**
 * Zod schema for the Pipeline Service configuration.
 *
 * Every field is optional with defaults matching DEFAULT_CONFIG.
 */

import { z } from 'zod';

const AgentNameSchema = z.enum([
  'tests', 'security', 'architecture', 'performance',
  'style', 'types', 'docs', 'integration',
]);

const TierConfigSchema = z.object({
  max_files: z.number().min(1).default(3),
  max_lines: z.number().min(1).default(50),
  agents: z.array(AgentNameSchema).min(1).default(['tests', 'style']),
});

const AgentSettingsSchema = z.object({
  model: z.string().default('sonnet'),
  permissionMode: z.string().default('autoEdit'),
  maxTurns: z.number().int().min(1).max(500).default(200),
});

const CircuitBreakerEntrySchema = z.object({
  failure_threshold: z.number().int().min(1).default(3),
  reset_timeout_ms: z.number().int().min(1000).default(60_000),
});

const DLQConfigSchema = z.object({
  enabled: z.boolean().default(true),
  path: z.string().default('.pipeline/dlq'),
  max_retries: z.number().int().min(1).default(5),
  base_delay_ms: z.number().int().min(100).default(5_000),
  backoff_factor: z.number().min(1).default(3),
});

export const PipelineServiceConfigSchema = z.object({
  tiers: z.object({
    small: TierConfigSchema.default({ max_files: 3, max_lines: 50, agents: ['tests', 'style'] }),
    medium: TierConfigSchema.default({ max_files: 10, max_lines: 300, agents: ['tests', 'security', 'architecture', 'style', 'types'] }),
    large: TierConfigSchema.default({ max_files: Infinity, max_lines: Infinity, agents: ['tests', 'security', 'architecture', 'performance', 'style', 'types', 'docs', 'integration'] }),
  }).default({}),

  branch: z.object({
    pipeline_prefix: z.string().default('pipeline/'),
    integration_prefix: z.string().default('integration/'),
    main: z.string().default('main'),
  }).default({}),

  agents: z.object({
    pipeline: AgentSettingsSchema.default({ model: 'sonnet', permissionMode: 'autoEdit', maxTurns: 200 }),
    conflict: AgentSettingsSchema.default({ model: 'opus', permissionMode: 'autoEdit', maxTurns: 50 }),
  }).default({}),

  auto_correction: z.object({
    max_attempts: z.number().int().min(0).default(2),
  }).default({}),

  resilience: z.object({
    circuit_breaker: z.object({
      claude: CircuitBreakerEntrySchema.default({ failure_threshold: 3, reset_timeout_ms: 60_000 }),
      github: CircuitBreakerEntrySchema.default({ failure_threshold: 5, reset_timeout_ms: 120_000 }),
    }).default({}),
    dlq: DLQConfigSchema.default({}),
  }).default({}),

  director: z.object({
    auto_trigger_delay_ms: z.number().int().min(0).default(500),
    default_priority: z.number().int().min(0).default(10),
    schedule_interval_ms: z.number().int().min(0).default(0),
  }).default({}),

  cleanup: z.object({
    keep_on_failure: z.boolean().default(false),
    stale_branch_days: z.number().int().min(1).default(7),
  }).default({}),

  adapters: z.object({
    webhooks: z.array(z.object({
      url: z.string().url(),
      secret: z.string().optional(),
      events: z.array(z.string()).optional(),
      timeout_ms: z.number().int().min(1000).default(10_000),
    })).default([]),
    retry_interval_ms: z.number().int().min(5_000).default(60_000),
  }).default({}),

  webhook_secret: z.string().optional(),

  events: z.object({
    path: z.string().nullable().default(null),
  }).default({}),

  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }).default({}),
});

export type PipelineServiceConfig = z.infer<typeof PipelineServiceConfigSchema>;
