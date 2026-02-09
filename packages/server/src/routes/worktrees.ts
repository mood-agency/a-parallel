import { Hono } from 'hono';
import * as pm from '../services/project-manager.js';
import * as wm from '../services/worktree-manager.js';
import { createWorktreeSchema, deleteWorktreeSchema, validate } from '../validation/schemas.js';

export const worktreeRoutes = new Hono();

// GET /api/worktrees?projectId=xxx
worktreeRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) {
    return c.json({ error: 'projectId is required' }, 400);
  }

  const project = pm.getProject(projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const worktrees = await wm.listWorktrees(project.path);
  return c.json(worktrees);
});

// POST /api/worktrees
worktreeRoutes.post('/', async (c) => {
  const raw = await c.req.json();
  const parsed = validate(createWorktreeSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const { projectId, branchName, baseBranch } = parsed.data;

  const project = pm.getProject(projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const worktreePath = await wm.createWorktree(project.path, branchName, baseBranch);
  return c.json({ path: worktreePath, branch: branchName }, 201);
});

// DELETE /api/worktrees
worktreeRoutes.delete('/', async (c) => {
  const raw = await c.req.json();
  const parsed = validate(deleteWorktreeSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const { projectId, worktreePath } = parsed.data;

  const project = pm.getProject(projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  await wm.removeWorktree(project.path, worktreePath);
  return c.json({ ok: true });
});
