import { Hono } from 'hono';
import * as tm from '../services/thread-manager.js';
import * as pm from '../services/project-manager.js';
import * as wm from '../services/worktree-manager.js';
import { startAgent, stopAgent, isAgentRunning } from '../services/agent-runner.js';
import { nanoid } from 'nanoid';
import { createThreadSchema, sendMessageSchema, updateThreadSchema, validate } from '../validation/schemas.js';
import { requireThread, requireThreadWithMessages, requireProject } from '../utils/route-helpers.js';
import { NotFound } from '../middleware/error-handler.js';

export const threadRoutes = new Hono();

/** Create a URL-safe slug from a title for branch naming */
function slugifyTitle(title: string, maxLength = 40): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, maxLength)
    .replace(/-$/, '') || 'thread';
}

// GET /api/threads?projectId=xxx&includeArchived=true
threadRoutes.get('/', (c) => {
  const projectId = c.req.query('projectId');
  const includeArchived = c.req.query('includeArchived') === 'true';
  const threads = tm.listThreads({ projectId: projectId || undefined, includeArchived });
  return c.json(threads);
});

// GET /api/threads/archived?page=1&limit=100&search=xxx
threadRoutes.get('/archived', (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') || '100', 10)));
  const search = c.req.query('search')?.trim() || '';

  const { threads, total } = tm.listArchivedThreads({ page, limit, search });
  return c.json({ threads, total, page, limit });
});

// GET /api/threads/:id
threadRoutes.get('/:id', (c) => {
  const result = requireThreadWithMessages(c.req.param('id'));
  return c.json(result);
});

// POST /api/threads
threadRoutes.post('/', async (c) => {
  const raw = await c.req.json();
  const parsed = validate(createThreadSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const { projectId, title, mode, model, permissionMode, baseBranch, prompt, images } = parsed.data;

  const project = requireProject(projectId);

  const threadId = nanoid();
  let worktreePath: string | undefined;
  let threadBranch: string | undefined;

  // Create worktree if needed
  const resolvedBaseBranch = baseBranch?.trim() || undefined;
  if (mode === 'worktree') {
    const slug = slugifyTitle(title || prompt);
    const projectSlug = slugifyTitle(project.name);
    const branchName = `${projectSlug}/${slug}-${threadId.slice(0, 6)}`;
    try {
      worktreePath = await wm.createWorktree(project.path, branchName, resolvedBaseBranch);
      threadBranch = branchName;
    } catch (e: any) {
      return c.json({ error: `Failed to create worktree: ${e.message}` }, 500);
    }
  }

  const thread = {
    id: threadId,
    projectId,
    title: title || prompt,
    mode,
    permissionMode: permissionMode || 'autoEdit',
    status: 'pending' as const,
    branch: threadBranch,
    baseBranch: mode === 'worktree' ? resolvedBaseBranch : undefined,
    worktreePath,
    cost: 0,
    createdAt: new Date().toISOString(),
  };

  tm.createThread(thread);

  // Determine working directory for agent
  const cwd = worktreePath ?? project.path;

  // Start agent asynchronously
  const pMode = permissionMode || 'autoEdit';
  startAgent(threadId, prompt, cwd, model || 'sonnet', pMode, images).catch((err) => {
    console.error(`[agent] Error in thread ${threadId}:`, err);
    tm.updateThread(threadId, { status: 'failed', completedAt: new Date().toISOString() });
  });

  return c.json(thread, 201);
});

// POST /api/threads/:id/message
threadRoutes.post('/:id/message', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.json();
  const parsed = validate(sendMessageSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const { content, model, permissionMode, images } = parsed.data;
  const thread = requireThread(id);

  const cwd = thread.worktreePath ?? pm.getProject(thread.projectId)?.path;
  if (!cwd) throw NotFound('Project path not found');

  const effectiveModel = (model || 'sonnet') as import('@a-parallel/shared').ClaudeModel;
  const effectivePermission = (permissionMode || thread.permissionMode || 'autoEdit') as import('@a-parallel/shared').PermissionMode;

  startAgent(id, content, cwd, effectiveModel, effectivePermission, images).catch(console.error);
  return c.json({ ok: true });
});

// POST /api/threads/:id/stop
threadRoutes.post('/:id/stop', async (c) => {
  await stopAgent(c.req.param('id'));
  return c.json({ ok: true });
});

// PATCH /api/threads/:id — update thread fields (e.g. archived)
threadRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.json();
  const parsed = validate(updateThreadSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const thread = requireThread(id);

  const updates: Record<string, any> = {};
  if (parsed.data.archived !== undefined) {
    updates.archived = parsed.data.archived ? 1 : 0;
  }

  // Cleanup worktree + branch when archiving
  if (parsed.data.archived && thread.worktreePath) {
    const project = pm.getProject(thread.projectId);
    if (project) {
      await wm.removeWorktree(project.path, thread.worktreePath).catch((e) => {
        console.warn(`[cleanup] Failed to remove worktree: ${e}`);
      });
      if (thread.branch) {
        await wm.removeBranch(project.path, thread.branch).catch((e) => {
          console.warn(`[cleanup] Failed to remove branch: ${e}`);
        });
      }
    }
    updates.worktreePath = null;
    updates.branch = null;
  }

  if (Object.keys(updates).length > 0) {
    tm.updateThread(id, updates);
  }

  const updated = tm.getThread(id);
  return c.json(updated);
});

// DELETE /api/threads/:id
threadRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const thread = tm.getThread(id);

  if (thread) {
    // Stop agent if running
    if (isAgentRunning(id)) {
      stopAgent(id).catch(console.error);
    }

    // Remove worktree + branch if exists
    if (thread.worktreePath) {
      const project = pm.getProject(thread.projectId);
      if (project) {
        await wm.removeWorktree(project.path, thread.worktreePath).catch((e) => {
          console.warn(`[cleanup] Failed to remove worktree: ${e}`);
        });
        if (thread.branch) {
          await wm.removeBranch(project.path, thread.branch).catch((e) => {
            console.warn(`[cleanup] Failed to remove branch: ${e}`);
          });
        }
      }
    }

    // Cascade delete handles messages + tool_calls
    tm.deleteThread(id);
  }

  return c.json({ ok: true });
});
