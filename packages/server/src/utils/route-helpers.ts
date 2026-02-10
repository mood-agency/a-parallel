/**
 * Route helper utilities — throw AppError instead of returning inline JSON errors.
 * These are used in route handlers to reduce boilerplate for common lookups.
 */

import * as tm from '../services/thread-manager.js';
import * as pm from '../services/project-manager.js';
import { NotFound } from '../middleware/error-handler.js';

/** Get a thread by ID or throw 404 */
export function requireThread(id: string) {
  const thread = tm.getThread(id);
  if (!thread) throw NotFound('Thread not found');
  return thread;
}

/** Get a thread with messages by ID or throw 404 */
export function requireThreadWithMessages(id: string) {
  const result = tm.getThreadWithMessages(id);
  if (!result) throw NotFound('Thread not found');
  return result;
}

/** Get a project by ID or throw 404 */
export function requireProject(id: string) {
  const project = pm.getProject(id);
  if (!project) throw NotFound('Project not found');
  return project;
}

/**
 * Resolve the working directory for a thread or throw 404.
 * Returns worktreePath if set, otherwise the project path.
 */
export function requireThreadCwd(threadId: string): string {
  const thread = requireThread(threadId);
  if (thread.worktreePath) return thread.worktreePath;
  const project = pm.getProject(thread.projectId);
  if (!project) throw NotFound('Project not found');
  return project.path;
}
