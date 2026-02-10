import { Hono } from 'hono';
import * as tm from '../services/thread-manager.js';
import * as pm from '../services/project-manager.js';
import { getDiff, stageFiles, unstageFiles, revertFiles, commit, push, createPR, mergeBranch, git } from '../utils/git-v2.js';
import * as wm from '../services/worktree-manager.js';
import { validate, mergeSchema } from '../validation/schemas.js';

export const gitRoutes = new Hono();

// Helper: resolve working directory for a thread
function resolveThreadCwd(threadId: string): string | null {
  const thread = tm.getThread(threadId);
  if (!thread) return null;

  if (thread.worktreePath) return thread.worktreePath;

  const project = pm.getProject(thread.projectId);
  return project?.path ?? null;
}

// GET /api/git/:threadId/diff
gitRoutes.get('/:threadId/diff', async (c) => {
  const cwd = resolveThreadCwd(c.req.param('threadId'));
  if (!cwd) return c.json({ error: 'Thread not found' }, 404);

  try {
    const diffs = await getDiff(cwd);
    return c.json(diffs);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/git/:threadId/stage
gitRoutes.post('/:threadId/stage', async (c) => {
  const cwd = resolveThreadCwd(c.req.param('threadId'));
  if (!cwd) return c.json({ error: 'Thread not found' }, 404);

  const { paths } = await c.req.json<{ paths: string[] }>();
  try {
    await stageFiles(cwd, paths);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/git/:threadId/unstage
gitRoutes.post('/:threadId/unstage', async (c) => {
  const cwd = resolveThreadCwd(c.req.param('threadId'));
  if (!cwd) return c.json({ error: 'Thread not found' }, 404);

  const { paths } = await c.req.json<{ paths: string[] }>();
  try {
    await unstageFiles(cwd, paths);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/git/:threadId/revert
gitRoutes.post('/:threadId/revert', async (c) => {
  const cwd = resolveThreadCwd(c.req.param('threadId'));
  if (!cwd) return c.json({ error: 'Thread not found' }, 404);

  const { paths } = await c.req.json<{ paths: string[] }>();
  try {
    await revertFiles(cwd, paths);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/git/:threadId/commit
gitRoutes.post('/:threadId/commit', async (c) => {
  const cwd = resolveThreadCwd(c.req.param('threadId'));
  if (!cwd) return c.json({ error: 'Thread not found' }, 404);

  const { message } = await c.req.json<{ message: string }>();
  try {
    const result = await commit(cwd, message);
    return c.json({ ok: true, output: result });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/git/:threadId/push
gitRoutes.post('/:threadId/push', async (c) => {
  const cwd = resolveThreadCwd(c.req.param('threadId'));
  if (!cwd) return c.json({ error: 'Thread not found' }, 404);

  try {
    const result = await push(cwd);
    return c.json({ ok: true, output: result });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/git/:threadId/pr
gitRoutes.post('/:threadId/pr', async (c) => {
  const threadId = c.req.param('threadId');
  const cwd = resolveThreadCwd(threadId);
  if (!cwd) return c.json({ error: 'Thread not found' }, 404);

  const thread = tm.getThread(threadId);
  const { title, body } = await c.req.json<{ title: string; body: string }>();
  try {
    const url = await createPR(cwd, title, body, thread?.baseBranch ?? undefined);
    return c.json({ ok: true, url });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/git/:threadId/merge
gitRoutes.post('/:threadId/merge', async (c) => {
  const threadId = c.req.param('threadId');
  const thread = tm.getThread(threadId);
  if (!thread) return c.json({ error: 'Thread not found' }, 404);

  if (thread.mode !== 'worktree' || !thread.branch) {
    return c.json({ error: 'Merge is only available for worktree threads' }, 400);
  }

  const project = pm.getProject(thread.projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const raw = await c.req.json().catch(() => ({}));
  const parsed = validate(mergeSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const targetBranch = parsed.data.targetBranch || thread.baseBranch;
  if (!targetBranch) {
    return c.json({ error: 'No target branch specified and no baseBranch set on thread' }, 400);
  }

  try {
    const output = await mergeBranch(project.path, thread.branch, targetBranch);

    if (parsed.data.push) {
      await git(['push', 'origin', targetBranch], project.path);
    }

    if (parsed.data.cleanup && thread.worktreePath) {
      await wm.removeWorktree(project.path, thread.worktreePath).catch(console.warn);
      await wm.removeBranch(project.path, thread.branch).catch(console.warn);
      tm.updateThread(threadId, { worktreePath: null, branch: null });
    }

    return c.json({ ok: true, output });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});
