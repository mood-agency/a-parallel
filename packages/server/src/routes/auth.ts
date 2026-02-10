import { Hono } from 'hono';
import { getAuthToken } from '../services/auth-service.js';

export const authRoutes = new Hono();

/**
 * GET /api/auth/token
 * Returns the auth token. Protected by CORS (only allowed origins can read it).
 * This endpoint is exempt from bearer auth middleware.
 */
authRoutes.get('/token', (c) => {
  return c.json({ token: getAuthToken() });
});
