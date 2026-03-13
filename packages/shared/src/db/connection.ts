/**
 * Database connection factory — creates SQLite or PostgreSQL Drizzle instances.
 *
 * Both runtime and server import from here to get a consistent DB setup.
 * SQLite setup includes WAL mode, foreign keys, and periodic checkpointing.
 * PostgreSQL setup uses Bun's native SQL client.
 */

import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

import { getDbMode, getDatabaseUrl } from './db-mode.js';
import * as pgSchema from './schema.pg.js';
import * as sqliteSchema from './schema.sqlite.js';

// Use the SQLite schema as the canonical type shape (both are structurally equivalent)
export type AppDatabase = BunSQLiteDatabase<typeof sqliteSchema>;

export interface DatabaseConnection {
  db: AppDatabase;
  schema: typeof sqliteSchema;
  /** Raw SQLite instance — only available in SQLite mode */
  sqlite: import('bun:sqlite').Database | null;
  /** Raw PostgreSQL client — only available in PostgreSQL mode */
  pgClient: any | null;
  mode: 'sqlite' | 'postgres';
  /** Cleanup: close connections, clear timers */
  close(): Promise<void>;
}

export interface CreateSqliteOptions {
  mode: 'sqlite';
  /** Absolute path to the .db file */
  path: string;
  /** Optional logger for warnings/info */
  log?: { info: (msg: string, meta?: any) => void; warn: (msg: string, meta?: any) => void };
}

export interface CreatePostgresOptions {
  mode: 'postgres';
  /** PostgreSQL connection URL. If omitted, reads from env (DATABASE_URL or DB_HOST+DB_USER). */
  url?: string;
  /** Optional logger */
  log?: { info: (msg: string, meta?: any) => void; warn: (msg: string, meta?: any) => void };
}

const noop = { info: () => {}, warn: () => {} };

/**
 * Create a SQLite database connection with WAL mode, foreign keys, and periodic checkpointing.
 */
export function createSqliteDatabase(options: CreateSqliteOptions): DatabaseConnection {
  // Dynamic import to avoid errors when bun:sqlite is not available
  const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
  const { drizzle } = require('drizzle-orm/bun-sqlite') as typeof import('drizzle-orm/bun-sqlite');

  const logger = options.log ?? noop;
  const sqliteDb = new Database(options.path);

  sqliteDb.exec('PRAGMA journal_mode = WAL');
  sqliteDb.exec('PRAGMA foreign_keys = ON');

  const WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;
  const walCheckpointTimer = setInterval(() => {
    try {
      sqliteDb.exec('PRAGMA wal_checkpoint(PASSIVE)');
    } catch (err) {
      logger.warn('WAL checkpoint failed', { namespace: 'db', error: err });
    }
  }, WAL_CHECKPOINT_INTERVAL_MS);
  if (walCheckpointTimer.unref) walCheckpointTimer.unref();

  const db = drizzle(sqliteDb, { schema: sqliteSchema }) as AppDatabase;

  return {
    db,
    schema: sqliteSchema,
    sqlite: sqliteDb,
    pgClient: null,
    mode: 'sqlite',
    async close() {
      clearInterval(walCheckpointTimer);
      try {
        sqliteDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch {}
      try {
        sqliteDb.close();
        logger.info('Database closed', { namespace: 'db' });
      } catch (err) {
        logger.warn('Error closing database', { namespace: 'db', error: err });
      }
    },
  };
}

/**
 * Create a PostgreSQL database connection using Bun's native SQL client.
 */
export async function createPostgresDatabase(
  options: CreatePostgresOptions,
): Promise<DatabaseConnection> {
  const logger = options.log ?? noop;

  const databaseUrl = options.url ?? getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(
      'PostgreSQL connection not configured. Provide either DATABASE_URL or DB_HOST + DB_USER.',
    );
  }

  const { SQL } = await import('bun');
  const { drizzle: drizzlePg } = await import('drizzle-orm/bun-sql');

  const pgClient = new SQL(databaseUrl);
  const db = drizzlePg({ client: pgClient, schema: pgSchema }) as unknown as AppDatabase;

  logger.info('Connected to PostgreSQL', { namespace: 'db' });

  return {
    db,
    schema: pgSchema as unknown as typeof sqliteSchema,
    sqlite: null,
    pgClient,
    mode: 'postgres',
    async close() {
      try {
        await pgClient.close();
        logger.info('PostgreSQL connection closed', { namespace: 'db' });
      } catch (err) {
        logger.warn('Error closing PostgreSQL connection', { namespace: 'db', error: err });
      }
    },
  };
}

/**
 * Auto-detect mode from environment and create the appropriate connection.
 */
export async function createDatabase(
  options:
    | CreateSqliteOptions
    | CreatePostgresOptions
    | { mode?: undefined; path?: string; url?: string; log?: any },
): Promise<DatabaseConnection> {
  const mode = options.mode ?? getDbMode();

  if (mode === 'sqlite') {
    if (!('path' in options) || !options.path) {
      throw new Error('SQLite mode requires a path option');
    }
    return createSqliteDatabase({ mode: 'sqlite', path: options.path, log: options.log });
  }

  return createPostgresDatabase({ mode: 'postgres', url: (options as any).url, log: options.log });
}

// ── Compat helpers (work with both SQLite sync & PostgreSQL async) ──

/** Execute a SELECT query and return all rows. */
export async function dbAll<T = any>(query: any): Promise<T[]> {
  if (typeof query.all === 'function') return query.all();
  return query;
}

/** Execute a SELECT query and return the first row. */
export async function dbGet<T = any>(query: any): Promise<T | undefined> {
  if (typeof query.get === 'function') return query.get();
  const rows = await query;
  return rows[0];
}

/** Execute a mutation query (INSERT/UPDATE/DELETE). */
export async function dbRun(query: any): Promise<void> {
  if (typeof query.run === 'function') {
    query.run();
    return;
  }
  await query;
}
