/**
 * RequestLogger — structured per-request JSONL logging.
 *
 * Each pipeline run gets its own log file at:
 *   .pipeline/logs/{requestId}.jsonl
 *
 * A system-level log aggregates Director/Integrator/DLQ activity:
 *   .pipeline/logs/system.jsonl
 *
 * Log entries are structured JSON with fields:
 *   timestamp, level, source, request_id, action, message, data, duration_ms
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// ── Types ───────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogSource =
  | 'pipeline.runner'
  | 'pipeline.agent'
  | 'pipeline.correction'
  | 'director'
  | 'integrator'
  | 'integrator.conflict'
  | 'branch-cleaner'
  | 'dlq'
  | 'webhook'
  | 'system';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  request_id: string;
  action: string;
  message: string;
  data?: Record<string, unknown>;
  duration_ms?: number;
}

export interface LogQueryParams {
  source?: LogSource;
  level?: LogLevel;
  from?: string;   // ISO timestamp
  to?: string;     // ISO timestamp
  limit?: number;
  offset?: number;
}

// ── Level priority (for filtering) ──────────────────────────────

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ── RequestLogger ───────────────────────────────────────────────

export class RequestLogger {
  private logsDir: string;
  private minLevel: LogLevel;

  constructor(projectPath: string, minLevel: LogLevel = 'info') {
    this.logsDir = join(projectPath, '.pipeline', 'logs');
    this.minLevel = minLevel;

    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Write a log entry to the appropriate file.
   */
  async log(entry: Omit<LogEntry, 'timestamp'>): Promise<void> {
    if (LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const fullEntry: LogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    const line = JSON.stringify(fullEntry) + '\n';

    // Write to per-request file
    if (entry.request_id && entry.request_id !== 'system') {
      await this.appendToFile(join(this.logsDir, `${entry.request_id}.jsonl`), line);
    }

    // Also write to system log for non-pipeline sources
    const systemSources: LogSource[] = ['director', 'integrator', 'integrator.conflict', 'branch-cleaner', 'dlq', 'webhook', 'system'];
    if (systemSources.includes(entry.source)) {
      await this.appendToFile(join(this.logsDir, 'system.jsonl'), line);
    }
  }

  /**
   * Convenience: log at info level.
   */
  async info(source: LogSource, requestId: string, action: string, message: string, data?: Record<string, unknown>): Promise<void> {
    await this.log({ level: 'info', source, request_id: requestId, action, message, data });
  }

  /**
   * Convenience: log at warn level.
   */
  async warn(source: LogSource, requestId: string, action: string, message: string, data?: Record<string, unknown>): Promise<void> {
    await this.log({ level: 'warn', source, request_id: requestId, action, message, data });
  }

  /**
   * Convenience: log at error level.
   */
  async error(source: LogSource, requestId: string, action: string, message: string, data?: Record<string, unknown>): Promise<void> {
    await this.log({ level: 'error', source, request_id: requestId, action, message, data });
  }

  /**
   * Read logs for a specific request, with optional filters.
   */
  async queryLogs(requestId: string, params: LogQueryParams = {}): Promise<LogEntry[]> {
    const filePath = join(this.logsDir, `${requestId}.jsonl`);
    return this.readAndFilter(filePath, params);
  }

  /**
   * Read system logs with optional filters.
   */
  async querySystemLogs(params: LogQueryParams = {}): Promise<LogEntry[]> {
    const filePath = join(this.logsDir, 'system.jsonl');
    return this.readAndFilter(filePath, params);
  }

  /**
   * List all request IDs that have log files.
   */
  async listRequestIds(): Promise<string[]> {
    if (!existsSync(this.logsDir)) return [];

    const { readdirSync } = await import('fs');
    return readdirSync(this.logsDir)
      .filter((f) => f.endsWith('.jsonl') && f !== 'system.jsonl')
      .map((f) => f.replace('.jsonl', ''));
  }

  // ── Internal ──────────────────────────────────────────────────

  private async appendToFile(filePath: string, line: string): Promise<void> {
    try {
      const file = Bun.file(filePath);
      const existing = (await file.exists()) ? await file.text() : '';
      await Bun.write(filePath, existing + line);
    } catch {
      // Best-effort: don't crash on log write failure
    }
  }

  private async readAndFilter(filePath: string, params: LogQueryParams): Promise<LogEntry[]> {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return [];

    const text = await file.text();
    let entries = text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is LogEntry => e !== null);

    // Apply filters
    if (params.source) {
      entries = entries.filter((e) => e.source === params.source);
    }
    if (params.level) {
      const minPriority = LEVEL_PRIORITY[params.level];
      entries = entries.filter((e) => LEVEL_PRIORITY[e.level] >= minPriority);
    }
    if (params.from) {
      entries = entries.filter((e) => e.timestamp >= params.from!);
    }
    if (params.to) {
      entries = entries.filter((e) => e.timestamp <= params.to!);
    }

    // Apply offset + limit
    if (params.offset) {
      entries = entries.slice(params.offset);
    }
    if (params.limit) {
      entries = entries.slice(0, params.limit);
    }

    return entries;
  }
}
