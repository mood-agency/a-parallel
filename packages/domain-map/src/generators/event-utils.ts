import type { DomainAnnotation, DomainGraph } from '../types.js';

// ── Event adjacency ─────────────────────────────────────────────

export interface EventInfo {
  /** Node keys that emit this event (excluding event-bus pass-through) */
  emitters: string[];
  /** Node keys that consume this event */
  consumers: string[];
}

/**
 * Build a map of event → { emitters, consumers } from the graph.
 * Event-bus nodes (pass-through mediators) are excluded as emitters
 * unless they are the *only* source of an event.
 */
export function buildEventAdjacency(graph: DomainGraph): Map<string, EventInfo> {
  const adj = new Map<string, EventInfo>();

  // Initialize entries for all known events
  for (const e of graph.events) {
    adj.set(e, { emitters: [], consumers: [] });
  }

  for (const [key, node] of graph.nodes) {
    const bus = isEventBus(node);

    for (const e of node.emits) {
      const info = adj.get(e);
      if (!info) continue;
      if (!bus) info.emitters.push(key);
    }

    for (const e of node.consumes) {
      const info = adj.get(e);
      if (!info) continue;
      info.consumers.push(key);
    }
  }

  // If an event has zero non-bus emitters, fall back to bus nodes
  for (const [eventName, info] of adj) {
    if (info.emitters.length === 0) {
      for (const [key, node] of graph.nodes) {
        if (isEventBus(node) && node.emits.includes(eventName)) {
          info.emitters.push(key);
        }
      }
    }
  }

  return adj;
}

// ── Event families ──────────────────────────────────────────────

/**
 * Group events by their colon prefix.
 * `agent:started` → family `agent`, `git:committed` → family `git`.
 */
export function groupEventsByFamily(events: Iterable<string>): Map<string, string[]> {
  const families = new Map<string, string[]>();

  for (const e of events) {
    const colonIdx = e.indexOf(':');
    const prefix = colonIdx > 0 ? e.slice(0, colonIdx) : e;
    const list = families.get(prefix) ?? [];
    list.push(e);
    families.set(prefix, list);
  }

  // Sort events within each family alphabetically
  for (const [, list] of families) {
    list.sort();
  }

  return families;
}

// ── Node classification ─────────────────────────────────────────

/** Check if a node is an event-bus (pass-through mediator). */
export function isEventBus(node: DomainAnnotation): boolean {
  return node.type === 'event-bus';
}

// ── Mermaid helpers (shared across generators) ──────────────────

export function sanitizeId(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Create a short participant ID from a node key like "Agent Execution::AgentRunner" */
export function shortId(nodeKey: string): string {
  const name = nodeKey.includes('::') ? nodeKey.split('::')[1] : nodeKey;
  // Abbreviate: take uppercase letters + first 3 chars as fallback
  const uppers = name.replace(/[^A-Z]/g, '');
  return uppers.length >= 2 ? uppers : sanitizeId(name).slice(0, 8);
}

export const TYPE_ICONS: Record<string, string> = {
  'bounded-context': '🏛️',
  'anti-corruption-layer': '🛡️',
  'published-language': '📜',
  'context-map': '🗺️',
  'aggregate-root': '🔷',
  entity: '🔹',
  'value-object': '📦',
  'domain-event': '⚡',
  'domain-service': '⚙️',
  'app-service': '🔧',
  repository: '🗄️',
  factory: '🏭',
  specification: '🔍',
  policy: '📋',
  module: '📂',
  port: '🔌',
  adapter: '🔗',
  'event-bus': '📡',
  handler: '📥',
};
