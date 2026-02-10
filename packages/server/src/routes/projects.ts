import { Hono } from 'hono';
import * as pm from '../services/project-manager.js';
import * as sc from '../services/startup-commands-service.js';
import { listBranches, getDefaultBranch } from '../utils/git-v2.js';
import { startCommand, stopCommand, isCommandRunning } from '../services/command-runner.js';
import { createProjectSchema, createCommandSchema, validate } from '../validation/schemas.js';

export const projectRoutes = new Hono();

function buildCommandWithPort(command: string, port: number): string {
  const trimmed = command.trimStart();
  const usesPackageManager = /^(npm|npx|pnpm|yarn|bun)\s/.test(trimmed);
  if (usesPackageManager) {
    return `${command} -- --port ${port}`;
  }
  return `${command} --port ${port}`;
}

// GET /api/projects
projectRoutes.get('/', (c) => {
  const projects = pm.listProjects();
  return c.json(projects);
});

// POST /api/projects
projectRoutes.post('/', async (c) => {
  const raw = await c.req.json();
  const parsed = validate(createProjectSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const { name, path } = parsed.data;

  try {
    const project = pm.createProject(name, path);
    return c.json(project, 201);
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// DELETE /api/projects/:id
projectRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  pm.deleteProject(id);
  return c.json({ ok: true });
});

// GET /api/projects/:id/branches
projectRoutes.get('/:id/branches', async (c) => {
  const id = c.req.param('id');
  const project = pm.getProject(id);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  try {
    const [branches, defaultBranch] = await Promise.all([
      listBranches(project.path),
      getDefaultBranch(project.path),
    ]);
    return c.json({ branches, defaultBranch });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── Startup Commands ───────────────────────────────────

// GET /api/projects/:id/commands
projectRoutes.get('/:id/commands', (c) => {
  const id = c.req.param('id');
  const commands = sc.listCommands(id);
  return c.json(commands);
});

// POST /api/projects/:id/commands
projectRoutes.post('/:id/commands', async (c) => {
  const projectId = c.req.param('id');
  const raw = await c.req.json();
  const parsed = validate(createCommandSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const { label, command, port, portEnvVar } = parsed.data;

  const entry = sc.createCommand({ projectId, label, command, port, portEnvVar });
  return c.json(entry, 201);
});

// PUT /api/projects/:id/commands/:cmdId
projectRoutes.put('/:id/commands/:cmdId', async (c) => {
  const cmdId = c.req.param('cmdId');
  const raw = await c.req.json();
  const parsed = validate(createCommandSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const { label, command, port, portEnvVar } = parsed.data;

  sc.updateCommand(cmdId, { label, command, port, portEnvVar });
  return c.json({ ok: true });
});

// DELETE /api/projects/:id/commands/:cmdId
projectRoutes.delete('/:id/commands/:cmdId', (c) => {
  const cmdId = c.req.param('cmdId');
  sc.deleteCommand(cmdId);
  return c.json({ ok: true });
});

// ─── Command Execution ─────────────────────────────────

// POST /api/projects/:id/commands/:cmdId/start
projectRoutes.post('/:id/commands/:cmdId/start', async (c) => {
  const projectId = c.req.param('id');
  const cmdId = c.req.param('cmdId');

  const project = pm.getProject(projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const cmd = sc.getCommand(cmdId);
  if (!cmd) {
    return c.json({ error: 'Command not found' }, 404);
  }

  const finalCommand = cmd.port ? buildCommandWithPort(cmd.command, cmd.port) : cmd.command;
  const extraEnv: Record<string, string> = {};
  if (cmd.port && cmd.portEnvVar) {
    extraEnv[cmd.portEnvVar] = String(cmd.port);
  }
  await startCommand(cmdId, finalCommand, project.path, projectId, cmd.label, extraEnv, cmd.port);
  return c.json({ ok: true });
});

// POST /api/projects/:id/commands/:cmdId/stop
projectRoutes.post('/:id/commands/:cmdId/stop', async (c) => {
  const cmdId = c.req.param('cmdId');
  await stopCommand(cmdId);
  return c.json({ ok: true });
});

// GET /api/projects/:id/commands/:cmdId/status
projectRoutes.get('/:id/commands/:cmdId/status', (c) => {
  const cmdId = c.req.param('cmdId');
  return c.json({ running: isCommandRunning(cmdId) });
});
