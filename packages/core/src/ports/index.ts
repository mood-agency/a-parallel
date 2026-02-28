import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { getWorktreeBase } from '../git/worktree.js';
import { readProjectConfig } from './config-reader.js';
import { copyAndOverrideEnv, readAllocatedPorts } from './env-writer.js';
import { allocatePorts } from './port-allocator.js';

export type { PortAllocation } from './port-allocator.js';
export { readProjectConfig } from './config-reader.js';
export { isPortAvailable, findAvailablePort, allocatePorts } from './port-allocator.js';
export { copyAndOverrideEnv, readAllocatedPorts } from './env-writer.js';

/**
 * Read .funny.json from the project, allocate unique ports for a new worktree,
 * and copy .env files with port overrides into the worktree.
 *
 * No-op if the project has no .funny.json or no portGroups/envFiles configured.
 */
export async function allocateWorktreePorts(projectPath: string, worktreePath: string) {
  const config = readProjectConfig(projectPath);
  if (!config?.portGroups?.length || !config?.envFiles?.length) return [];

  const envFiles = config.envFiles;
  const exclude = await collectSiblingPorts(projectPath, worktreePath, envFiles);
  const allocations = await allocatePorts(config.portGroups, exclude);

  // For each .env file, figure out which port vars it originally contains,
  // and only write those — don't pollute server .env with client-only vars.
  for (const relPath of envFiles) {
    const relevantVars = detectRelevantVars(projectPath, relPath, allocations);
    const filtered = allocations
      .map((a) => ({
        ...a,
        envVars: a.envVars.filter((v) => relevantVars.has(v)),
      }))
      .filter((a) => a.envVars.length > 0);

    if (filtered.length > 0) {
      copyAndOverrideEnv(projectPath, worktreePath, relPath, filtered);
    }
  }

  return allocations;
}

/**
 * Check which port-related env vars already exist in the source .env file.
 * Only those vars will be overridden in the worktree copy.
 */
function detectRelevantVars(
  projectPath: string,
  relativeEnvPath: string,
  allocations: { envVars: string[] }[],
): Set<string> {
  const allPortVars = new Set<string>();
  for (const a of allocations) {
    for (const v of a.envVars) allPortVars.add(v);
  }

  const envPath = resolve(projectPath, relativeEnvPath);
  if (!existsSync(envPath)) return allPortVars; // New file — write all

  const content = readFileSync(envPath, 'utf-8');
  const found = new Set<string>();

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const varName = trimmed.slice(0, eqIdx).trim();
    if (allPortVars.has(varName)) found.add(varName);
  }

  return found;
}

async function collectSiblingPorts(
  projectPath: string,
  currentWorktreePath: string,
  envFiles: string[],
): Promise<Set<number>> {
  const ports = new Set<number>();

  const worktreeBase = await getWorktreeBase(projectPath);

  if (!existsSync(worktreeBase)) return ports;

  try {
    const entries = readdirSync(worktreeBase, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const siblingPath = resolve(worktreeBase, entry.name);
      if (siblingPath === currentWorktreePath) continue;

      const siblingPorts = readAllocatedPorts(siblingPath, envFiles);
      for (const p of siblingPorts) ports.add(p);
    }
  } catch {
    // Best-effort: if we can't read siblings, skip deduplication
  }

  return ports;
}
