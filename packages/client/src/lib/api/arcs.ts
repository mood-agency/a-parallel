import type { Arc, ArcArtifacts, Thread } from '@funny/shared';

import { request } from './_core';

export const arcsApi = {
  listArcs: (projectId: string) => request<Arc[]>(`/projects/${projectId}/arcs`),
  createArc: (projectId: string, name: string) =>
    request<Arc>(`/projects/${projectId}/arcs`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  getArc: (id: string) => request<Arc>(`/arcs/${id}`),
  deleteArc: (id: string) => request<{ ok: boolean }>(`/arcs/${id}`, { method: 'DELETE' }),
  listArcThreads: (arcId: string) => request<Thread[]>(`/arcs/${arcId}/threads`),
  getArcArtifacts: (arcId: string, name: string, projectId: string) =>
    request<{ artifacts: ArcArtifacts }>(
      `/arcs/${arcId}/artifacts?name=${encodeURIComponent(name)}&projectId=${encodeURIComponent(projectId)}`,
    ),
  createArcDirectory: (projectId: string, name: string) =>
    request<{ ok: boolean; path: string }>(`/projects/${projectId}/arcs/directory`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
};
