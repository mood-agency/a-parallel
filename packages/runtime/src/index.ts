/**
 * @domain subdomain: Shared Kernel
 * @domain type: bounded-context
 * @domain layer: infrastructure
 *
 * Standalone runtime entry point.
 * Creates the Hono app via createRuntimeApp() and starts Bun.serve().
 */

// On Windows, bun --watch forks worker processes — each has its own globalThis.
// Ghost sockets from previous workers can block the port.
if (process.platform === 'win32') {
  await import('./kill-port.js');
}

import { createRuntimeApp } from './app.js';
import { log } from './lib/logger.js';
import { shutdownManager, ShutdownPhase } from './services/shutdown-manager.js';

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '127.0.0.1';

// Create the runtime app
const runtime = await createRuntimeApp();

// Clean up previous instance on bun --watch restarts.
const prev = (globalThis as any).__bunServer;
const prevCleanup = (globalThis as any).__bunCleanup as (() => Promise<void>) | undefined;
if (prev) {
  prev.stop(true);
  if (prevCleanup) await prevCleanup();
  log.info('Cleaned up previous instance (watch restart)', { namespace: 'server' });
}

// Initialize (DB, migrations, auth, handlers)
await runtime.init();

const server = Bun.serve({
  port,
  hostname: host,
  reusePort: true,
  async fetch(req: Request, server: any) {
    const url = new URL(req.url);

    // Handle WebSocket upgrade
    if (url.pathname === '/ws/transcribe' || url.pathname === '/ws') {
      const wsData = await runtime.authenticateWs(req);
      if (!wsData) return new Response('Unauthorized', { status: 401 });
      if (server.upgrade(req, { data: wsData })) return;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // All other requests handled by Hono
    return runtime.app.fetch(req);
  },
  websocket: runtime.websocket,
});

// ── Shutdown registry ──────────────────────────────────────────
shutdownManager.register('http-server', () => server.stop(true), ShutdownPhase.SERVER);

import { destroyAllInstances } from '@funny/memory';
shutdownManager.register('memory-shutdown', () => destroyAllInstances(), ShutdownPhase.SERVICES);

shutdownManager.register(
  'process-exit',
  () => {
    if (process.platform === 'win32') {
      try {
        Bun.spawnSync(['cmd', '/c', `taskkill /F /T /PID ${process.pid}`]);
      } catch {}
    }
    process.exit(0);
  },
  ShutdownPhase.FINAL,
  false,
);

// Store for next --watch restart
(globalThis as any).__bunServer = server;
(globalThis as any).__bunCleanup = () => shutdownManager.run('hotReload');

// Graceful shutdown
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('Shutting down...', { namespace: 'server' });

  const forceExit = setTimeout(() => {
    log.warn('Force exit after timeout', { namespace: 'server' });
    if (process.platform === 'win32') {
      try {
        Bun.spawnSync(['cmd', '/c', `taskkill /F /T /PID ${process.pid}`]);
      } catch {}
    }
    process.exit(1);
  }, 5000);

  await shutdownManager.run('hard');
  clearTimeout(forceExit);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

// Catch unhandled errors
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception — keeping server alive', {
    namespace: 'server',
    error: err?.message ?? String(err),
    stack: err?.stack,
  });
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  log.error('Unhandled rejection — keeping server alive', {
    namespace: 'server',
    error: msg,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

log.info(`Listening on http://localhost:${server.port}`, {
  namespace: 'server',
  port: server.port,
  host,
});
