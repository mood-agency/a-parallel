/**
 * WebhookAdapter — delivers pipeline events via HTTP POST.
 *
 * Supports optional event filtering and HMAC secret for verification.
 */

import type { IOutboundAdapter } from './adapter.js';
import type { PipelineEvent } from '../core/types.js';

export interface WebhookConfig {
  url: string;
  secret?: string;
  events?: string[];
  timeout_ms?: number;
}

export class WebhookAdapter implements IOutboundAdapter {
  readonly name: string;
  private url: string;
  private secret?: string;
  private events?: Set<string>;
  private timeoutMs: number;

  constructor(config: WebhookConfig) {
    this.url = config.url;
    this.secret = config.secret;
    this.events = config.events?.length ? new Set(config.events) : undefined;
    this.timeoutMs = config.timeout_ms ?? 10_000;

    // Name includes the host for identification
    try {
      this.name = `webhook:${new URL(config.url).host}`;
    } catch {
      this.name = `webhook:${config.url}`;
    }
  }

  async deliver(event: PipelineEvent): Promise<void> {
    // Filter: skip events not in the allow-list
    if (this.events && !this.events.has(event.event_type)) {
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.secret) {
      headers['X-Webhook-Secret'] = this.secret;
    }

    const response = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Webhook delivery failed: ${response.status} ${response.statusText}`);
    }
  }
}
