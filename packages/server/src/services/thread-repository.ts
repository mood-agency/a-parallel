/**
 * @domain subdomain: Thread Management
 * @domain subdomain-type: core
 * @domain type: repository
 * @domain layer: infrastructure
 * @domain aggregate: Thread
 * @domain depends: Database, StageHistory, CommentRepository
 */

import { eq, and, or, ne, like, desc, count as drizzleCount, sql } from 'drizzle-orm';

import { db, sqlite, schema } from '../db/index.js';
import { log } from '../lib/logger.js';
import { getCommentCounts } from './comment-repository.js';
import { recordStageChange } from './stage-history.js';

/** Max characters for the last-message snippet returned with thread lists */
const SNIPPET_MAX_LENGTH = 120;

/** Escape SQL LIKE wildcards so user input is treated as literal text */
function escapeLike(value: string): string {
  return value.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** List threads, optionally filtered by projectId, userId, and archive status */
export function listThreads(opts: {
  projectId?: string;
  userId: string;
  includeArchived?: boolean;
}) {
  const { projectId, userId, includeArchived } = opts;
  const filters: ReturnType<typeof eq>[] = [];

  if (userId !== '__local__') {
    filters.push(eq(schema.threads.userId, userId));
  }
  if (projectId) {
    filters.push(eq(schema.threads.projectId, projectId));
  }
  if (!includeArchived) {
    filters.push(eq(schema.threads.archived, 0));
  }

  const condition = filters.length > 0 ? and(...filters) : undefined;
  const completionTime = sql`COALESCE(${schema.threads.completedAt}, ${schema.threads.createdAt})`;
  const threads = db
    .select()
    .from(schema.threads)
    .where(condition)
    .orderBy(desc(schema.threads.pinned), desc(completionTime))
    .all();

  if (threads.length > 0) {
    const ids = threads.map((t) => t.id);
    const counts = getCommentCounts(ids);
    const snippets = getLastAssistantSnippets(ids);
    return threads.map((t) => ({
      ...t,
      commentCount: counts.get(t.id) ?? 0,
      lastAssistantMessage: snippets.get(t.id),
    }));
  }
  return threads;
}

/** List archived threads with pagination and search */
export function listArchivedThreads(opts: {
  page: number;
  limit: number;
  search: string;
  userId: string;
}) {
  const { page, limit, search, userId } = opts;
  const offset = (page - 1) * limit;

  const safeSearch = search ? escapeLike(search) : '';
  const filters: ReturnType<typeof eq>[] = [eq(schema.threads.archived, 1)];

  if (userId !== '__local__') {
    filters.push(eq(schema.threads.userId, userId));
  }

  if (search) {
    filters.push(
      or(
        like(schema.threads.title, `%${safeSearch}%`),
        like(schema.threads.branch, `%${safeSearch}%`),
        like(schema.threads.status, `%${safeSearch}%`),
      ) as any,
    );
  }

  const conditions = and(...filters);

  const [{ total }] = db
    .select({ total: drizzleCount() })
    .from(schema.threads)
    .where(conditions!)
    .all();

  const completionTime = sql`COALESCE(${schema.threads.completedAt}, ${schema.threads.createdAt})`;
  const threads = db
    .select()
    .from(schema.threads)
    .where(conditions!)
    .orderBy(desc(completionTime))
    .limit(limit)
    .offset(offset)
    .all();

  return { threads, total };
}

/** Get a single thread by ID */
export function getThread(id: string) {
  return db.select().from(schema.threads).where(eq(schema.threads.id, id)).get();
}

/** Get a thread by its external request ID (used by ingest mapper) */
export function getThreadByExternalRequestId(requestId: string) {
  return db
    .select()
    .from(schema.threads)
    .where(eq(schema.threads.externalRequestId, requestId))
    .get();
}

/** Insert a new thread */
export function createThread(data: typeof schema.threads.$inferInsert) {
  db.insert(schema.threads).values(data).run();
  const initialStage = data.stage ?? 'backlog';
  recordStageChange(data.id, null, initialStage);
}

/** Update thread fields by ID */
export function updateThread(
  id: string,
  updates: Partial<{
    status: string;
    sessionId: string | null;
    cost: number;
    completedAt: string | null;
    archived: number;
    pinned: number;
    stage: string;
    branch: string | null;
    baseBranch: string | null;
    worktreePath: string | null;
    mode: string;
    permissionMode: string;
    model: string;
    provider: string;
    initTools: string;
    initCwd: string;
  }>,
) {
  if (updates.stage !== undefined) {
    const currentThread = db
      .select({ stage: schema.threads.stage })
      .from(schema.threads)
      .where(eq(schema.threads.id, id))
      .get();

    if (currentThread && currentThread.stage !== updates.stage) {
      recordStageChange(id, currentThread.stage, updates.stage);
    }
  }

  if (updates.archived !== undefined) {
    const currentThread = db
      .select({ stage: schema.threads.stage, archived: schema.threads.archived })
      .from(schema.threads)
      .where(eq(schema.threads.id, id))
      .get();

    if (currentThread) {
      if (updates.archived === 1 && currentThread.archived === 0) {
        recordStageChange(id, currentThread.stage, 'archived');
      } else if (updates.archived === 0 && currentThread.archived === 1) {
        recordStageChange(id, 'archived', updates.stage ?? currentThread.stage);
      }
    }
  }

  db.update(schema.threads).set(updates).where(eq(schema.threads.id, id)).run();
}

/** Delete a thread (cascade deletes messages + tool_calls) */
export function deleteThread(id: string) {
  db.delete(schema.threads).where(eq(schema.threads.id, id)).run();
}

/**
 * Fetch the last non-empty assistant message snippet for a batch of thread IDs.
 * Uses a single raw SQL query with a window function for efficiency.
 */
function getLastAssistantSnippets(threadIds: string[]): Map<string, string> {
  if (threadIds.length === 0) return new Map();

  const placeholders = threadIds.map(() => '?').join(',');
  const rows = sqlite
    .prepare(
      `SELECT thread_id, SUBSTR(content, 1, ${SNIPPET_MAX_LENGTH}) AS snippet
       FROM (
         SELECT thread_id, content,
                ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY timestamp DESC) AS rn
         FROM messages
         WHERE thread_id IN (${placeholders})
           AND role = 'assistant'
           AND content != ''
       )
       WHERE rn = 1`,
    )
    .all(...threadIds) as { thread_id: string; snippet: string }[];

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.thread_id, row.snippet);
  }
  return map;
}

/** Mark stale (running/waiting) threads as interrupted. Called on server startup. */
export function markStaleThreadsInterrupted(): void {
  const staleCondition = and(
    or(eq(schema.threads.status, 'running'), eq(schema.threads.status, 'waiting')),
    ne(schema.threads.provider, 'external'),
  );

  const stale = db
    .select({ id: schema.threads.id })
    .from(schema.threads)
    .where(staleCondition)
    .all();

  if (stale.length > 0) {
    db.update(schema.threads)
      .set({ status: 'interrupted', completedAt: new Date().toISOString() })
      .where(staleCondition)
      .run();
    log.info(`Marked ${stale.length} stale thread(s) as interrupted`, {
      namespace: 'thread-manager',
      count: stale.length,
    });
  }
}

/** Mark stale external threads (running/pending) as stopped. Called on server startup. */
export function markStaleExternalThreadsStopped(): void {
  const staleCondition = and(
    or(
      eq(schema.threads.status, 'running'),
      eq(schema.threads.status, 'pending'),
      eq(schema.threads.status, 'waiting'),
    ),
    eq(schema.threads.provider, 'external'),
  );

  const stale = db
    .select({ id: schema.threads.id })
    .from(schema.threads)
    .where(staleCondition)
    .all();

  if (stale.length > 0) {
    db.update(schema.threads)
      .set({ status: 'stopped', completedAt: new Date().toISOString() })
      .where(staleCondition)
      .run();
    log.info(`Marked ${stale.length} stale external thread(s) as stopped`, {
      namespace: 'thread-manager',
      count: stale.length,
    });
  }
}
