import { Hono } from 'hono';
import { describe, test, expect, beforeEach, vi } from 'vitest';

import type { HonoEnv } from '../../types/hono-env.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

// Mock Better Auth
const mockGetSession = vi.fn<() => Promise<any | null>>(() => Promise.resolve(null));
vi.mock('../../lib/auth.js', () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are registered
// ---------------------------------------------------------------------------

const { authMiddleware, requireAdmin } = await import('../../middleware/auth.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fresh Hono app with authMiddleware applied to all routes. */
function createApp() {
  const app = new Hono<HonoEnv>();
  app.use('*', authMiddleware);
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/auth/mode', (c) => c.json({ mode: 'multi' }));
  app.get('/api/bootstrap', (c) => c.json({ bootstrapped: true }));
  app.get('/api/auth/login', (c) => c.json({ login: true }));
  app.get('/api/auth/some-other', (c) => c.json({ auth: true }));
  app.get('/api/mcp/oauth/callback', (c) => c.json({ callback: true }));
  app.get('/api/projects', (c) => c.json({ userId: c.get('userId'), role: c.get('userRole') }));
  return app;
}

/** Build a Hono app with authMiddleware + requireAdmin chained. */
function createAdminApp() {
  const app = new Hono<HonoEnv>();
  app.use('*', authMiddleware);
  app.use('/api/admin/*', requireAdmin);
  app.get('/api/admin/users', (c) => c.json({ userId: c.get('userId'), role: c.get('userRole') }));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authMiddleware', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
  });

  // -----------------------------------------------------------------------
  // Public paths — bypass auth
  // -----------------------------------------------------------------------

  describe('public paths bypass auth', () => {
    test('/api/health bypasses auth', async () => {
      const app = createApp();
      const res = await app.request('/api/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    test('/api/auth/mode bypasses auth', async () => {
      const app = createApp();
      const res = await app.request('/api/auth/mode');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ mode: 'multi' });
    });

    test('/api/bootstrap bypasses auth', async () => {
      const app = createApp();
      const res = await app.request('/api/bootstrap');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ bootstrapped: true });
    });

    test('public paths bypass auth even without any credentials', async () => {
      const app = createApp();
      for (const path of ['/api/health', '/api/auth/mode', '/api/bootstrap']) {
        const res = await app.request(path);
        expect(res.status).toBe(200);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Auth route bypass
  // -----------------------------------------------------------------------

  describe('auth routes bypass auth', () => {
    test('/api/auth/* paths bypass auth', async () => {
      const app = createApp();
      const res = await app.request('/api/auth/login');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ login: true });
    });

    test('/api/auth/some-other also bypasses auth', async () => {
      const app = createApp();
      const res = await app.request('/api/auth/some-other');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ auth: true });
    });

    test('/api/mcp/oauth/callback bypasses auth', async () => {
      const app = createApp();
      const res = await app.request('/api/mcp/oauth/callback');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ callback: true });
    });
  });

  // -----------------------------------------------------------------------
  // Better Auth session (Priority 3)
  // -----------------------------------------------------------------------

  describe('Better Auth session', () => {
    test('returns 401 when no session exists', async () => {
      mockGetSession.mockResolvedValue(null);

      const app = createApp();
      const res = await app.request('/api/projects');
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    test('valid session sets userId and userRole', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-42', role: 'admin' },
        session: { activeOrganizationId: null },
      });

      const app = createApp();
      const res = await app.request('/api/projects');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe('user-42');
      expect(body.role).toBe('admin');
    });

    test('session user without role defaults to "user"', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-99' },
        session: { activeOrganizationId: null },
      });

      const app = createApp();
      const res = await app.request('/api/projects');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe('user-99');
      expect(body.role).toBe('user');
    });
  });
});

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

describe('requireAdmin', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
  });

  test('returns 403 for non-admin user', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-regular', role: 'user' },
      session: { activeOrganizationId: null },
    });

    const app = createAdminApp();
    const res = await app.request('/api/admin/users');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Forbidden: admin required' });
  });

  test('allows admin user', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-admin', role: 'admin' },
      session: { activeOrganizationId: null },
    });

    const app = createAdminApp();
    const res = await app.request('/api/admin/users');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user-admin');
    expect(body.role).toBe('admin');
  });

  test('returns 403 when role is undefined (no role set)', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-norole' },
      session: { activeOrganizationId: null },
    });

    const app = createAdminApp();
    const res = await app.request('/api/admin/users');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Forbidden: admin required' });
  });
});
