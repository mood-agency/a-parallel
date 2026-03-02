import type { DomainGraph } from '../types.js';
import {
  buildEventAdjacency,
  groupEventsByFamily,
  sanitizeId,
  TYPE_ICONS,
  type EventInfo,
} from './event-utils.js';

// ── Options ─────────────────────────────────────────────────────

export interface SequenceOptions {
  /** Filter to a specific event family prefix (e.g., 'agent', 'git', 'thread') */
  scenario?: string;
  /** Show ThreadEventBus as explicit mediator participant (default: false) */
  showBus?: boolean;
}

// ── Main generator ──────────────────────────────────────────────

/**
 * Generate Mermaid sequence diagram(s) from a DomainGraph.
 *
 * Each event family becomes a separate diagram section.
 * Events are rendered as arrows from emitter → consumer (or emitter → bus → consumer
 * when showBus is true).
 */
export function generateSequence(graph: DomainGraph, options?: SequenceOptions): string {
  const showBus = options?.showBus ?? false;
  const adj = buildEventAdjacency(graph);
  const families = groupEventsByFamily(adj.keys());

  if (adj.size === 0) {
    return '%% No events found in annotations\n';
  }

  // Filter to requested scenario
  const targetFamilies = options?.scenario
    ? ([[options.scenario, families.get(options.scenario) ?? []]] as [string, string[]][])
    : [...families.entries()].sort(([a], [b]) => a.localeCompare(b));

  if (targetFamilies.length === 0 || targetFamilies[0][1].length === 0) {
    return `%% No events found for scenario "${options?.scenario}"\n`;
  }

  const sections: string[] = [];

  for (const [family, events] of targetFamilies) {
    // Skip families with no event flows (all orphans or dead letters)
    const hasFlows = events.some((e) => {
      const info = adj.get(e);
      return info && info.emitters.length > 0 && info.consumers.length > 0;
    });
    if (!hasFlows) continue;

    sections.push(generateFamilyDiagram(graph, adj, family, events, showBus));
  }

  if (sections.length === 0) {
    return '%% No event flows found (all events are orphans or dead letters)\n';
  }

  return sections.join('\n\n');
}

// ── Per-family diagram ──────────────────────────────────────────

function generateFamilyDiagram(
  graph: DomainGraph,
  adj: Map<string, EventInfo>,
  family: string,
  events: string[],
  showBus: boolean,
): string {
  const lines: string[] = [];

  // Find the event-bus node in the graph (for --show-bus mode)
  let busKey: string | null = null;
  if (showBus) {
    for (const [key, node] of graph.nodes) {
      if (node.type === 'event-bus') {
        busKey = key;
        break;
      }
    }
  }

  // Collect all participants for this family (only from events that have both ends)
  const participantKeys = new Set<string>();

  for (const eventName of events) {
    const info = adj.get(eventName);
    if (!info || info.emitters.length === 0 || info.consumers.length === 0) continue;
    for (const k of info.emitters) participantKeys.add(k);
    for (const k of info.consumers) participantKeys.add(k);
  }

  // Order participants: emitters-only → mixed → consumers-only
  const emitterOnly = new Set<string>();
  const consumerOnly = new Set<string>();
  const mixed = new Set<string>();

  for (const key of participantKeys) {
    if (key === busKey && showBus) continue; // bus rendered separately

    let emits = false;
    let consumes = false;

    for (const eventName of events) {
      const info = adj.get(eventName)!;
      if (info.emitters.includes(key)) emits = true;
      if (info.consumers.includes(key)) consumes = true;
    }

    if (emits && consumes) mixed.add(key);
    else if (emits) emitterOnly.add(key);
    else consumerOnly.add(key);
  }

  const ordered = [...emitterOnly, ...mixed, ...consumerOnly];

  // ── Header ──────────────────────────────────────────────

  lines.push(`%% ── ${family} events ──`);
  lines.push('sequenceDiagram');

  // ── Participants ────────────────────────────────────────

  const idMap = new Map<string, string>();
  const usedIds = new Set<string>();

  if (showBus && busKey) {
    const bid = uniqueId('EB', usedIds);
    idMap.set(busKey, bid);
    const busNode = graph.nodes.get(busKey);
    const label = busNode ? busNode.name : 'EventBus';
    lines.push(`    participant ${bid} as ${label}<br/>‹event-bus›`);
  }

  for (const key of ordered) {
    const node = graph.nodes.get(key);
    if (!node) continue;

    const id = uniqueId(abbreviate(node.name), usedIds);
    idMap.set(key, id);

    const icon = TYPE_ICONS[node.type] ?? '';
    lines.push(`    participant ${id} as ${icon} ${node.name}<br/>‹${node.type}›`);
  }

  lines.push('');

  // ── Event arrows ────────────────────────────────────────

  // Sort events to show lifecycle order: *:started before *:completed, etc.
  const sortedEvents = sortEventsTemporally(events);

  for (const eventName of sortedEvents) {
    const info = adj.get(eventName);
    if (!info) continue;

    const emitters = info.emitters.filter((k) => idMap.has(k));
    const consumers = info.consumers.filter((k) => idMap.has(k));

    // Skip events with no consumers (orphans) or no emitters (dead letters)
    if (emitters.length === 0 || consumers.length === 0) continue;

    for (const emitterKey of emitters) {
      const fromId = idMap.get(emitterKey)!;

      if (showBus && busKey && idMap.has(busKey)) {
        const busId = idMap.get(busKey)!;
        // emitter → bus
        lines.push(`    ${fromId}->>${busId}: ${eventName}`);
        // bus → each consumer
        for (const consumerKey of consumers) {
          const toId = idMap.get(consumerKey)!;
          lines.push(`    ${busId}->>${toId}: ${eventName}`);
        }
      } else {
        // Direct: emitter → each consumer
        for (const consumerKey of consumers) {
          const toId = idMap.get(consumerKey)!;
          lines.push(`    ${fromId}->>${toId}: ${eventName}`);
        }
      }
    }

    // Add spacing between events for readability
    if (emitters.length > 0 || consumers.length > 0) {
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────

/** Abbreviate a name: "AgentRunner" → "AR", "git-event-persistence-handler" → "GEPH" */
function abbreviate(name: string): string {
  // PascalCase: take uppercase letters
  const uppers = name.replace(/[^A-Z]/g, '');
  if (uppers.length >= 2) return uppers;

  // kebab-case: take first letter of each segment
  if (name.includes('-')) {
    const abbr = name
      .split('-')
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('');
    if (abbr.length >= 2) return abbr;
  }

  return sanitizeId(name).slice(0, 8);
}

/** Generate a unique ID, appending a number if needed */
function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (used.has(`${base}${i}`)) i++;
  const id = `${base}${i}`;
  used.add(id);
  return id;
}

/**
 * Sort events within a family for temporal display.
 * Heuristic: events ending in certain suffixes get ordered naturally.
 */
function sortEventsTemporally(events: string[]): string[] {
  const order: Record<string, number> = {
    created: 1,
    started: 2,
    changed: 3,
    staged: 4,
    unstaged: 5,
    committed: 6,
    pushed: 7,
    pulled: 8,
    merged: 9,
    reverted: 10,
    stashed: 11,
    'stash-popped': 12,
    'reset-soft': 13,
    'stage-changed': 14,
    completed: 90,
    stopped: 91,
    error: 92,
    failed: 93,
    deleted: 95,
  };

  return [...events].sort((a, b) => {
    const suffA = a.includes(':') ? a.split(':').slice(1).join(':') : a;
    const suffB = b.includes(':') ? b.split(':').slice(1).join(':') : b;
    const oA = order[suffA] ?? 50;
    const oB = order[suffB] ?? 50;
    if (oA !== oB) return oA - oB;
    return a.localeCompare(b);
  });
}
