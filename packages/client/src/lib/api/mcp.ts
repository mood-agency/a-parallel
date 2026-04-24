import type { McpAddRequest, McpServer } from '@funny/shared';

import { request } from './_core';

export const mcpApi = {
  listMcpServers: (projectPath: string) =>
    request<{ servers: McpServer[] }>(
      `/mcp/servers?projectPath=${encodeURIComponent(projectPath)}`,
    ),
  addMcpServer: (data: McpAddRequest) =>
    request<{ ok: boolean }>('/mcp/servers', { method: 'POST', body: JSON.stringify(data) }),
  removeMcpServer: (name: string, projectPath: string) =>
    request<{ ok: boolean }>(
      `/mcp/servers/${encodeURIComponent(name)}?projectPath=${encodeURIComponent(projectPath)}`,
      { method: 'DELETE' },
    ),
  toggleMcpServer: (name: string, projectPath: string, disabled: boolean) =>
    request<{ ok: boolean }>(`/mcp/servers/${encodeURIComponent(name)}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ projectPath, disabled }),
    }),
  getRecommendedMcpServers: () => request<{ servers: McpServer[] }>('/mcp/recommended'),
  startMcpOAuth: (serverName: string, projectPath: string) =>
    request<{ authUrl: string }>('/mcp/oauth/start', {
      method: 'POST',
      body: JSON.stringify({ serverName, projectPath }),
    }),
  setMcpToken: (serverName: string, projectPath: string, token: string) =>
    request<{ ok: boolean }>('/mcp/oauth/token', {
      method: 'POST',
      body: JSON.stringify({ serverName, projectPath, token }),
    }),
};
