import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

import type { PortAllocation } from './port-allocator.js';

const MARKER = '# === Funny Port Allocation (auto-generated) ===';

/**
 * Copy an .env file from the original project into the worktree at the same
 * relative path, then override port variables with allocated values.
 *
 * If the source .env doesn't exist, creates a new file with only the port vars.
 */
export function copyAndOverrideEnv(
  projectPath: string,
  worktreePath: string,
  relativeEnvPath: string,
  allocations: PortAllocation[],
): string {
  const sourcePath = resolve(projectPath, relativeEnvPath);
  const targetPath = resolve(worktreePath, relativeEnvPath);

  // Ensure target directory exists
  mkdirSync(dirname(targetPath), { recursive: true });

  // Build set of env var names that are ports
  const portVarNames = new Set<string>();
  for (const alloc of allocations) {
    for (const v of alloc.envVars) portVarNames.add(v);
  }

  // Read source .env (from original project, not worktree)
  let sourceLines: string[] = [];
  if (existsSync(sourcePath)) {
    sourceLines = readFileSync(sourcePath, 'utf-8').split('\n');
  }

  // Keep all non-port lines, strip old marker
  const filteredLines = sourceLines.filter((line) => {
    if (line === MARKER) return false;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return true;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return true;
    const varName = trimmed.slice(0, eqIdx).trim();
    return !portVarNames.has(varName);
  });

  // Remove trailing empty lines
  while (filteredLines.length > 0 && filteredLines[filteredLines.length - 1].trim() === '') {
    filteredLines.pop();
  }

  // Append port allocations
  filteredLines.push('');
  filteredLines.push(MARKER);
  for (const alloc of allocations) {
    // Only write vars that are relevant to this env file
    for (const envVar of alloc.envVars) {
      if (portVarNames.has(envVar)) {
        filteredLines.push(`${envVar}=${alloc.port}`);
      }
    }
  }
  filteredLines.push('');

  writeFileSync(targetPath, filteredLines.join('\n'), 'utf-8');
  return targetPath;
}

/**
 * Read previously allocated ports from .env files in a worktree directory.
 * Scans all .env files found at the given paths.
 */
export function readAllocatedPorts(
  worktreePath: string,
  envFilePaths: string[] = ['.env'],
): Set<number> {
  const ports = new Set<number>();

  for (const relPath of envFilePaths) {
    const envPath = resolve(worktreePath, relPath);
    if (!existsSync(envPath)) continue;

    const content = readFileSync(envPath, 'utf-8');

    let inFunnySection = false;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === MARKER) {
        inFunnySection = true;
        continue;
      }
      if (!inFunnySection) continue;
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const value = parseInt(trimmed.slice(eqIdx + 1), 10);
      if (!isNaN(value) && value > 0 && value <= 65535) {
        ports.add(value);
      }
    }
  }

  return ports;
}
