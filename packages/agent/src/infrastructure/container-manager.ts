/**
 * ContainerManager — orchestrates container lifecycle for pipelines.
 *
 * Detects compose files in worktrees, starts containers via Podman,
 * waits for health checks, and creates CDP MCP servers for browser
 * automation. Provides cleanup for graceful shutdown.
 *
 * Uses ContainerService and createCdpMcpServer from @a-parallel/core
 * as the underlying library — this module handles orchestration only.
 */

import { ContainerService, createCdpMcpServer } from '@a-parallel/core/containers';
import type { CdpMcpServerResult } from '@a-parallel/core/containers';
import { logger } from './logger.js';

export class ContainerManager {
  private containerService: ContainerService;
  private cdpInstances = new Map<string, CdpMcpServerResult>();

  constructor() {
    this.containerService = new ContainerService();
  }

  /**
   * Detect compose file, start containers, wait for healthy,
   * and create a CDP MCP server with Playwright browser.
   *
   * Returns mcpServers config to pass to orchestrator.startAgent(),
   * or undefined if no compose file is found.
   */
  async setup(
    worktreePath: string,
    requestId: string,
  ): Promise<Record<string, any> | undefined> {
    const composeFile = await this.containerService.detectComposeFile(worktreePath);
    if (!composeFile) {
      logger.debug({ requestId, worktreePath }, 'No compose file found — skipping containers');
      return undefined;
    }

    logger.info({ requestId, worktreePath, composeFile }, 'Starting containers');

    // 1. Start containers via podman compose
    const state = await this.containerService.startContainers({
      threadId: requestId,
      worktreePath,
      composeFile,
    });

    // 2. Wait for health check
    await this.containerService.waitForHealthy(worktreePath);

    // 3. Find app URL from first exposed port
    const firstPort = [...state.exposedPorts.values()][0];
    if (!firstPort) {
      logger.warn({ requestId }, 'Containers running but no exposed ports found');
      return undefined;
    }

    const appUrl = `http://localhost:${firstPort}`;
    logger.info({ requestId, appUrl }, 'Containers healthy — creating CDP browser');

    // 4. Create CDP MCP server (Playwright headless browser)
    const cdp = createCdpMcpServer({ appUrl });
    this.cdpInstances.set(worktreePath, cdp);

    return { 'cdp-browser': cdp.server };
  }

  /**
   * Cleanup containers and browser for a single pipeline run.
   * Call when the pipeline completes, fails, or is stopped.
   */
  async cleanup(worktreePath: string): Promise<void> {
    // Dispose CDP browser
    const cdp = this.cdpInstances.get(worktreePath);
    if (cdp) {
      await cdp.dispose().catch(() => {});
      this.cdpInstances.delete(worktreePath);
    }

    // Stop containers
    await this.containerService.stopContainers(worktreePath).catch((err: any) => {
      logger.warn({ err: err.message, worktreePath }, 'Error stopping containers');
    });
  }

  /**
   * Cleanup all containers and browsers.
   * Call during server shutdown.
   */
  async cleanupAll(): Promise<void> {
    for (const [, cdp] of this.cdpInstances) {
      await cdp.dispose().catch(() => {});
    }
    this.cdpInstances.clear();
    await this.containerService.stopAll();
  }
}
