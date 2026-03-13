#!/usr/bin/env bun
import { existsSync } from 'fs';
import { resolve } from 'path';
import { parseArgs } from 'util';

// Parse CLI arguments
const { values } = parseArgs({
  options: {
    port: {
      type: 'string',
      short: 'p',
      default: '3001',
    },
    host: {
      type: 'string',
      short: 'h',
      default: '127.0.0.1',
    },
    team: {
      type: 'string',
      description: 'URL of the central server to connect to for team mode',
    },
    help: {
      type: 'boolean',
    },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`
funny - Parallel Claude Code agent orchestration

Usage:
  funny [options]

Options:
  -p, --port <port>          Server port (default: 3001)
  -h, --host <host>          Server host (default: 127.0.0.1)
  --team <url>               Connect to a central team server (e.g. http://192.168.1.10:3002)
  --help                     Show this help message

Examples:
  funny                          # Start standalone on http://127.0.0.1:3001
  funny --port 8080              # Start on custom port
  funny --team http://central:3002  # Connect to team server

Authentication:
  Always uses Better Auth with login page. Default admin account (admin/admin)
  is created on first startup. Change the password immediately.

Environment Variables:
  PORT                       Server port
  HOST                       Server host
  TEAM_SERVER_URL            Central team server URL (same as --team)
  CORS_ORIGIN                Custom CORS origins (comma-separated)
  DB_MODE                    Database mode: sqlite (default) or postgres
  DATABASE_URL               PostgreSQL connection URL (when DB_MODE=postgres)

For more information, visit: https://github.com/anthropics/funny
`);
  process.exit(0);
}

// Set environment variables from CLI args
process.env.PORT = values.port;
process.env.HOST = values.host;

if (values.team) {
  process.env.TEAM_SERVER_URL = values.team;
  console.log(`[funny] Team mode enabled — connecting to ${values.team}`);
}

// Generate RUNNER_AUTH_SECRET if not set
if (!process.env.RUNNER_AUTH_SECRET) {
  const crypto = await import('crypto');
  process.env.RUNNER_AUTH_SECRET = crypto.randomUUID();
}

// Resolve entry points — prefer server (unified entry), fall back to runtime (standalone)
const serverEntry = resolve(import.meta.dir, '../packages/server/dist/index.js');
const serverSrc = resolve(import.meta.dir, '../packages/server/src/index.ts');
const runtimeEntry = resolve(import.meta.dir, '../packages/runtime/dist/index.js');
const runtimeSrc = resolve(import.meta.dir, '../packages/runtime/src/index.ts');

// Try server first (unified architecture), then runtime (standalone)
if (existsSync(serverEntry)) {
  console.log('[funny] Starting from built server...');
  await import(serverEntry);
} else if (existsSync(serverSrc)) {
  console.log('[funny] Starting from server source...');
  await import(serverSrc);
} else if (existsSync(runtimeEntry)) {
  console.log('[funny] Starting from built runtime (standalone mode)...');
  await import(runtimeEntry);
} else if (existsSync(runtimeSrc)) {
  console.log('[funny] Starting from runtime source (standalone mode)...');
  await import(runtimeSrc);
} else {
  console.error('[funny] Error: Server files not found.');
  console.error('Please run "bun install" and "bun run build" first.');
  process.exit(1);
}
