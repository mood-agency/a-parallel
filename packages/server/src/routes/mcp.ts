import { Hono } from 'hono';
import {
  listMcpServers,
  addMcpServer,
  removeMcpServer,
  RECOMMENDED_SERVERS,
} from '../services/mcp-service.js';
import { addMcpServerSchema, validate } from '../validation/schemas.js';
import { BadRequest } from '../middleware/error-handler.js';

const app = new Hono();

// List MCP servers for a project
app.get('/servers', async (c) => {
  const projectPath = c.req.query('projectPath');
  if (!projectPath) throw BadRequest('projectPath query parameter required');

  const servers = await listMcpServers(projectPath);
  return c.json({ servers });
});

// Add an MCP server
app.post('/servers', async (c) => {
  const raw = await c.req.json();
  const parsed = validate(addMcpServerSchema, raw);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  await addMcpServer(parsed.data);
  return c.json({ ok: true });
});

// Remove an MCP server
app.delete('/servers/:name', async (c) => {
  const name = c.req.param('name');
  const projectPath = c.req.query('projectPath');
  const scope = c.req.query('scope') as 'project' | 'user' | undefined;

  if (!projectPath) throw BadRequest('projectPath query parameter required');

  await removeMcpServer({ name, projectPath, scope });
  return c.json({ ok: true });
});

// Get recommended MCP servers
app.get('/recommended', (c) => {
  return c.json({ servers: RECOMMENDED_SERVERS });
});

export default app;
