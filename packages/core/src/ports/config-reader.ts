import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import type { FunnyProjectConfig } from '@funny/shared';

const CONFIG_FILENAME = '.funny.json';

export function readProjectConfig(projectPath: string): FunnyProjectConfig | null {
  const configPath = resolve(projectPath, CONFIG_FILENAME);
  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as FunnyProjectConfig;
  } catch {
    return null;
  }
}
