import { request, type MemoryFact } from './_core';

export const memoryApi = {
  memorySearch: (
    projectId: string,
    query: string,
    filters?: { type?: string; tags?: string[]; minConfidence?: number },
  ) => {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (filters?.type) params.set('type', filters.type);
    if (filters?.tags?.length) params.set('tags', filters.tags.join(','));
    if (filters?.minConfidence != null) params.set('minConfidence', String(filters.minConfidence));
    return request<{ facts: MemoryFact[] }>(`/projects/${projectId}/memory/search?${params}`);
  },
  memoryTimeline: (projectId: string, opts?: { from?: string; to?: string; type?: string }) => {
    const params = new URLSearchParams();
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to) params.set('to', opts.to);
    if (opts?.type) params.set('type', opts.type);
    return request<{ facts: MemoryFact[] }>(`/projects/${projectId}/memory/timeline?${params}`);
  },
  memoryAddFact: (
    projectId: string,
    body: { content: string; type: string; tags?: string[]; confidence?: number },
  ) =>
    request<MemoryFact>(`/projects/${projectId}/memory/facts`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  memoryInvalidate: (projectId: string, factId: string, reason?: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/memory/facts/${factId}/invalidate`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    }),
  memoryEvolve: (projectId: string, factId: string, update: string) =>
    request<MemoryFact>(`/projects/${projectId}/memory/facts/${factId}/evolve`, {
      method: 'PATCH',
      body: JSON.stringify({ update }),
    }),
  memoryRunGC: (projectId: string) =>
    request<{ archived: number; deduplicated: number; orphaned: number }>(
      `/projects/${projectId}/memory/gc`,
      { method: 'POST' },
    ),
};
