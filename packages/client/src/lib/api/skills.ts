import type { PluginListResponse, Skill } from '@funny/shared';

import { request } from './_core';

export const skillsApi = {
  // Skills
  listSkills: (projectPath?: string) =>
    request<{ skills: Skill[] }>(
      `/skills${projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : ''}`,
    ),
  addSkill: (identifier: string) =>
    request<{ ok: boolean }>('/skills', { method: 'POST', body: JSON.stringify({ identifier }) }),
  removeSkill: (name: string) =>
    request<{ ok: boolean }>(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getRecommendedSkills: () => request<{ skills: Skill[] }>('/skills/recommended'),

  // Plugins
  listPlugins: () => request<PluginListResponse>('/plugins'),
};
