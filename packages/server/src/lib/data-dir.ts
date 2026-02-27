import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';

/**
 * Centralized data directory for all persistent files (DB, auth, keys, logs).
 * Override with FUNNY_DATA_DIR env var to use a custom location (e.g. for testing).
 */
export const DATA_DIR = resolve(process.env.FUNNY_DATA_DIR || resolve(homedir(), '.funny'));

// Ensure the directory exists on import
mkdirSync(DATA_DIR, { recursive: true });
