import type {
  AgentTemplate,
  CreateAgentTemplateRequest,
  UpdateAgentTemplateRequest,
} from '@funny/shared';

import { request } from './_core';

export const agentTemplatesApi = {
  listAgentTemplates: () => request<AgentTemplate[]>('/agent-templates'),
  getAgentTemplate: (id: string) => request<AgentTemplate>(`/agent-templates/${id}`),
  createAgentTemplate: (data: CreateAgentTemplateRequest) =>
    request<AgentTemplate>('/agent-templates', { method: 'POST', body: JSON.stringify(data) }),
  updateAgentTemplate: (id: string, data: UpdateAgentTemplateRequest) =>
    request<AgentTemplate>(`/agent-templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteAgentTemplate: (id: string) =>
    request<{ ok: boolean }>(`/agent-templates/${id}`, { method: 'DELETE' }),
  duplicateAgentTemplate: (id: string) =>
    request<AgentTemplate>(`/agent-templates/${id}/duplicate`, { method: 'POST' }),
  getAgentTemplateUsageStats: () => request<Record<string, number>>('/agent-templates/stats/usage'),
};
