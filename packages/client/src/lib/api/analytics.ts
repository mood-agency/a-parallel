import { request } from './_core';

export const analyticsApi = {
  // Analytics
  analyticsOverview: (projectId?: string, timeRange?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    params.set('tz', String(new Date().getTimezoneOffset()));
    const qs = params.toString();
    return request<any>(`/analytics/overview${qs ? `?${qs}` : ''}`);
  },
  analyticsTimeline: (projectId?: string, timeRange?: string, groupBy?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (timeRange) params.set('timeRange', timeRange);
    if (groupBy) params.set('groupBy', groupBy);
    params.set('tz', String(new Date().getTimezoneOffset()));
    const qs = params.toString();
    return request<any>(`/analytics/timeline${qs ? `?${qs}` : ''}`);
  },

  // Logs (observability)
  sendLogs: (
    logs: Array<{ level: string; message: string; attributes?: Record<string, string> }>,
  ) => request<{ ok: boolean }>('/logs', { method: 'POST', body: JSON.stringify({ logs }) }),
};
