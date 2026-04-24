import type {
  Automation,
  AutomationRun,
  CreateAutomationRequest,
  InboxItem,
  UpdateAutomationRequest,
} from '@funny/shared';

import { request } from './_core';

export const automationsApi = {
  listAutomations: (projectId?: string) =>
    request<Automation[]>(`/automations${projectId ? `?projectId=${projectId}` : ''}`),
  getAutomation: (id: string) => request<Automation>(`/automations/${id}`),
  createAutomation: (data: CreateAutomationRequest) =>
    request<Automation>('/automations', { method: 'POST', body: JSON.stringify(data) }),
  updateAutomation: (id: string, data: UpdateAutomationRequest) =>
    request<Automation>(`/automations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAutomation: (id: string) =>
    request<{ ok: boolean }>(`/automations/${id}`, { method: 'DELETE' }),
  triggerAutomation: (id: string) =>
    request<{ ok: boolean }>(`/automations/${id}/trigger`, { method: 'POST' }),
  listAutomationRuns: (automationId: string) =>
    request<AutomationRun[]>(`/automations/${automationId}/runs`),
  getAutomationInbox: (options?: { projectId?: string; triageStatus?: string }) => {
    const params = new URLSearchParams();
    if (options?.projectId) params.append('projectId', options.projectId);
    if (options?.triageStatus) params.append('triageStatus', options.triageStatus);
    const query = params.toString();
    return request<InboxItem[]>(`/automations/inbox${query ? `?${query}` : ''}`);
  },
  triageRun: (runId: string, triageStatus: 'pending' | 'reviewed' | 'dismissed') =>
    request<{ ok: boolean }>(`/automations/runs/${runId}/triage`, {
      method: 'PATCH',
      body: JSON.stringify({ triageStatus }),
    }),
};
