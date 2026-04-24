import { request } from './_core';

export const systemApi = {
  // Setup
  setupStatus: () =>
    request<{
      claudeCli: {
        available: boolean;
        path: string | null;
        error: string | null;
        version: string | null;
      };
      nativeGit: {
        loaded: boolean;
        disabled: boolean;
        rustAvailable: boolean;
        rustVersion: string | null;
        platform: string;
        canBuild: boolean;
      };
    }>('/setup/status'),

  // System
  getAvailableShells: () =>
    request<{
      shells: Array<{ id: string; label: string; path: string }>;
    }>('/system/shells'),
  buildNativeGit: () => request<{ status: string }>('/system/build-native-git', { method: 'POST' }),

  // Files (internal editor)
  readFile: (path: string) =>
    request<{ content: string }>(`/files/read?path=${encodeURIComponent(path)}`),
  writeFile: (path: string, content: string) =>
    request<{ ok: boolean }>('/files/write', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    }),
};
