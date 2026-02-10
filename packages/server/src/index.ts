import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler } from './middleware/error-handler.js';
import { autoMigrate } from './db/migrate.js';
import { markStaleThreadsInterrupted } from './services/thread-manager.js';
import { projectRoutes } from './routes/projects.js';
import { threadRoutes } from './routes/threads.js';
import { gitRoutes } from './routes/git.js';
import browseRoutes from './routes/browse.js';
import mcpRoutes from './routes/mcp.js';
import skillsRoutes from './routes/skills.js';
import pluginRoutes from './routes/plugins.js';
import { worktreeRoutes } from './routes/worktrees.js';
import { wsBroker } from './services/ws-broker.js';

const port = Number(process.env.PORT) || 3001;
const clientPort = Number(process.env.CLIENT_PORT) || 5173;

const app = new Hono();

// Middleware
app.use('*', errorHandler);
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: [
      `http://localhost:${clientPort}`,
      `http://127.0.0.1:${clientPort}`,
      'tauri://localhost',
      'https://tauri.localhost',
    ],
  })
);

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount routes
app.route('/api/projects', projectRoutes);
app.route('/api/threads', threadRoutes);
app.route('/api/git', gitRoutes);
app.route('/api/browse', browseRoutes);
app.route('/api/mcp', mcpRoutes);
app.route('/api/skills', skillsRoutes);
app.route('/api/plugins', pluginRoutes);
app.route('/api/worktrees', worktreeRoutes);

// Auto-create tables on startup, then start server
autoMigrate();
markStaleThreadsInterrupted();
// Server started below via Bun.serve()

const server = Bun.serve({
  port,
  reusePort: true,
  fetch(req: Request, server: any) {
    // Handle WebSocket upgrade
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (server.upgrade(req)) return;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }
    // All other requests handled by Hono
    return app.fetch(req);
  },
  websocket: {
    open(ws: any) {
      wsBroker.addClient(ws);
    },
    close(ws: any) {
      wsBroker.removeClient(ws);
    },
    message(_ws: any, _msg: any) {
      // No client→server messages needed for now
    },
  },
});

// Graceful shutdown — close the server so the port is released immediately
function shutdown() {
  console.log('[server] Shutting down...');
  server.stop(true);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[server] Listening on http://localhost:${server.port}`);
