/**
 * Auth Service — generates and validates a bearer token for API access.
 * Token is stored at ~/.a-parallel/auth-token and cached in memory.
 */

import { resolve } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';

const AUTH_DIR = resolve(homedir(), '.a-parallel');
const TOKEN_PATH = resolve(AUTH_DIR, 'auth-token');

let cachedToken: string | null = null;

/**
 * Get (or generate on first call) the auth token.
 * Reads from ~/.a-parallel/auth-token, creating it if it doesn't exist.
 */
export function getAuthToken(): string {
  if (cachedToken) return cachedToken;

  mkdirSync(AUTH_DIR, { recursive: true });

  if (existsSync(TOKEN_PATH)) {
    cachedToken = readFileSync(TOKEN_PATH, 'utf-8').trim();
    if (cachedToken.length > 0) return cachedToken;
  }

  // Generate a 32-byte (256-bit) random token, hex-encoded = 64 chars
  cachedToken = randomBytes(32).toString('hex');
  writeFileSync(TOKEN_PATH, cachedToken, { mode: 0o600 });
  console.log('[auth] Generated new auth token at', TOKEN_PATH);
  return cachedToken;
}

/**
 * Validate a provided token against the stored token.
 */
export function validateToken(token: string): boolean {
  return token === getAuthToken();
}
