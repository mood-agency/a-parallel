import type { DiscoverTestsResponse, RunTestResponse, TestFile } from '@funny/shared';

import { request } from './_core';

export const testsApi = {
  listTestFiles: (projectId: string) => request<TestFile[]>(`/tests/${projectId}/files`),
  discoverTestSpecs: (projectId: string, file: string) =>
    request<DiscoverTestsResponse>(`/tests/${projectId}/specs?file=${encodeURIComponent(file)}`),
  runTest: (projectId: string, file: string, line?: number, projects?: string[]) =>
    request<RunTestResponse>(`/tests/${projectId}/run`, {
      method: 'POST',
      body: JSON.stringify({
        file,
        ...(line != null && { line }),
        ...(projects?.length && { projects }),
      }),
    }),
  stopTest: (projectId: string) =>
    request<{ ok: boolean }>(`/tests/${projectId}/stop`, { method: 'POST' }),
};
