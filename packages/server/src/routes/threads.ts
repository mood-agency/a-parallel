import { Hono } from 'hono';
import * as tm from '../services/thread-manager.js';
import * as pm from '../services/project-manager.js';
import * as wm from '../services/worktree-manager.js';
import { startAgent, stopAgent, isAgentRunning } from '../services/agent-runner.js';
import { nanoid } from 'nanoid';
import { createThreadSchema, sendMessageSchema, updateThreadSchema, validate } from '../validation/schemas.js';

export const threadRoutes = new Hono();

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
  const id = c.req.param('id');
  const result = tm.getThreadWithMessages(id);

  if (!result) {
    return c.json({ error: 'Thread not found' }, 404);
  }

  return c.json(result);
});

// POST /api/threads
threadRoutes.post('/', async (c) => {
  const raw = await c.req.json();
  const parsed = validate(createThreadSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const { projectId, title, mode, model, permissionMode, branch, prompt, images } = parsed.data;

  const project = pm.getProject(projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const threadId = nanoid();
  let worktreePath: string | undefined;
  let threadBranch = branch;

  // Create worktree if needed
  if (mode === 'worktree') {
    const branchName = branch ?? `a-parallel/${threadId}`;
    try {
      worktreePath = await wm.createWorktree(project.path, branchName);
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
  const thread = tm.getThread(id);

  if (!thread) {
    return c.json({ error: 'Thread not found' }, 404);
  }

  const cwd = thread.worktreePath ?? pm.getProject(thread.projectId)?.path;
  if (!cwd) {
    return c.json({ error: 'Project path not found' }, 500);
  }

  const effectiveModel = (model || 'sonnet') as import('@a-parallel/shared').ClaudeModel;
  const effectivePermission = (permissionMode || thread.permissionMode || 'autoEdit') as import('@a-parallel/shared').PermissionMode;

  startAgent(id, content, cwd, effectiveModel, effectivePermission, images).catch(console.error);
  return c.json({ ok: true });
});

// POST /api/threads/:id/stop
threadRoutes.post('/:id/stop', async (c) => {
  const id = c.req.param('id');
  try {
    await stopAgent(id);
    return c.json({ ok: true });
  } catch (e: any) {
    console.error(`[threads] Failed to stop agent ${id}:`, e);
    return c.json({ error: e.message }, 500);
  }
});

// PATCH /api/threads/:id — update thread fields (e.g. archived)
threadRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.json();
  const parsed = validate(updateThreadSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const thread = tm.getThread(id);
  if (!thread) {
    return c.json({ error: 'Thread not found' }, 404);
  }

  const updates: Record<string, any> = {};
  if (parsed.data.archived !== undefined) {
    updates.archived = parsed.data.archived ? 1 : 0;
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

    // Remove worktree if exists
    if (thread.worktreePath) {
      const project = pm.getProject(thread.projectId);
      if (project) {
        await wm.removeWorktree(project.path, thread.worktreePath).catch((e) => {
          console.warn(`[cleanup] Failed to remove worktree: ${e}`);
        });
      }
    }

    // Cascade delete handles messages + tool_calls
    tm.deleteThread(id);
  }

  return c.json({ ok: true });
});
