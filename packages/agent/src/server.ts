/**
 * Bun server bootstrap for the Pipeline Service.
 */

import { app, runner, integrator, adapterManager, director, containerManager } from './index.js';

const port = parseInt(process.env.PORT ?? '3002', 10);

console.log(`[pipeline] Starting on port ${port}...`);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[pipeline] Shutting down...');
  director.stopSchedule();
  adapterManager.stop();
  await Promise.allSettled([runner.stopAll(), integrator.stopAll(), containerManager.cleanupAll()]);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[pipeline] Shutting down...');
  director.stopSchedule();
  adapterManager.stop();
  await Promise.allSettled([runner.stopAll(), integrator.stopAll(), containerManager.cleanupAll()]);
  process.exit(0);
});

export default {
  port,
  fetch: app.fetch,
};
