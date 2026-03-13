/**
 * Auth middleware for the central server.
 * Always uses Better Auth sessions for browser requests.
 * Runner auth via bearer token or X-Runner-Auth header.
 */

import type { Context, Next } from 'hono';

import type { ServerEnv } from '../lib/types.js';

const PUBLIC_PATHS = new Set(['/api/health', '/api/bootstrap', '/api/setup/status']);

const PUBLIC_PREFIXES = ['/api/invite-links/verify/', '/api/invite-links/register'];

export async function authMiddleware(c: Context<ServerEnv>, next: Next) {
  const path = new URL(c.req.url).pathname;

  // Public endpoints
  if (PUBLIC_PATHS.has(path)) return next();

  // Public invite-link paths
  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return next();

  // Auth routes are handled by their own handlers
  if (path.startsWith('/api/auth/')) return next();

  // MCP OAuth callback
  if (path === '/api/mcp/oauth/callback') return next();

  // ── Runner auth via bearer token ───────────────────────────────
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer runner_')) {
    const rm = await import('../services/runner-manager.js');
    const token = authHeader.slice(7);
    const runnerId = await rm.authenticateRunner(token);
    if (!runnerId) return c.json({ error: 'Invalid runner token' }, 401);

    c.set('runnerId', runnerId);
    c.set('isRunner', true);
    return next();
  }

  // ── Runner auth via shared secret ──────────────────────────────
  const RUNNER_AUTH_SECRET = process.env.RUNNER_AUTH_SECRET;
  if (RUNNER_AUTH_SECRET) {
    const runnerSecret = c.req.header('X-Runner-Auth');
    if (runnerSecret === RUNNER_AUTH_SECRET) {
      c.set('isRunner', true);
      return next();
    }
  }

  // ── Better Auth session ────────────────────────────────────────
  const { auth } = await import('../lib/auth.js');
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Unauthorized' }, 401);

  c.set('userId', session.user.id);
  c.set('userRole', (session.user as any).role || 'user');
  c.set('isRunner', false);

  const activeOrgId = (session.session as any).activeOrganizationId ?? null;
  c.set('organizationId', activeOrgId);

  return next();
}

export async function requireAdmin(c: Context<ServerEnv>, next: Next) {
  const role = c.get('userRole');
  if (role !== 'admin') {
    return c.json({ error: 'Forbidden: admin required' }, 403);
  }
  return next();
}
