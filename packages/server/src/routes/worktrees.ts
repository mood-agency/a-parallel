import { Hono } from 'hono';
import * as wm from '../services/worktree-manager.js';
import { createWorktreeSchema, deleteWorktreeSchema, validate } from '../validation/schemas.js';
import { requireProject } from '../utils/route-helpers.js';
import { BadRequest } from '../middleware/error-handler.js';

export const worktreeRoutes = new Hono();

// GET /api/worktrees?projectId=xxx
worktreeRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) throw BadRequest('projectId is required');

  const project = requireProject(projectId);
  const worktrees = await wm.listWorktrees(project.path);
  return c.json(worktrees);
});

// POST /api/worktrees
worktreeRoutes.post('/', async (c) => {
  const raw = await c.req.json();
  const parsed = validate(createWorktreeSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const { projectId, branchName, baseBranch } = parsed.data;

  const project = requireProject(projectId);
  const worktreePath = await wm.createWorktree(project.path, branchName, baseBranch);
  return c.json({ path: worktreePath, branch: branchName }, 201);
});

// DELETE /api/worktrees
worktreeRoutes.delete('/', async (c) => {
  const raw = await c.req.json();
  const parsed = validate(deleteWorktreeSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const { projectId, worktreePath } = parsed.data;

  const project = requireProject(projectId);
  await wm.removeWorktree(project.path, worktreePath);
  return c.json({ ok: true });
});
