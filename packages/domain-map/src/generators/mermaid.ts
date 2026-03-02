import type { DomainGraph } from '../types.js';
import { sanitizeId, TYPE_ICONS } from './event-utils.js';

// ── Options ──────────────────────────────────────────────────────

export interface MermaidOptions {
  /** Diagram direction: LR (left-right) or TB (top-bottom) */
  direction?: 'LR' | 'TB';
  /** Only show event flow, suppress dependency arrows */
  eventsOnly?: boolean;
  /** Collapse to subdomain-level view (one node per subdomain) */
  subdomainLevel?: boolean;
}

// ── Main generator ───────────────────────────────────────────────

export function generateMermaid(graph: DomainGraph, options?: MermaidOptions): string {
  const opts: Required<MermaidOptions> = {
    direction: options?.direction ?? 'LR',
    eventsOnly: options?.eventsOnly ?? false,
    subdomainLevel: options?.subdomainLevel ?? false,
  };

  const lines: string[] = [];

  lines.push(`flowchart ${opts.direction}`);
  lines.push('');

  // Style classes for layers
  addClassDefs(lines);
  lines.push('');

  if (opts.subdomainLevel) {
    addSubdomainLevelView(lines, graph);
  } else {
    addDetailedView(lines, graph, opts);
  }

  return lines.join('\n');
}

// ── Class definitions ────────────────────────────────────────────

function addClassDefs(lines: string[]): void {
  lines.push('  %% Layer styles');
  lines.push('  classDef domain fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20');
  lines.push('  classDef application fill:#E3F2FD,stroke:#1565C0,color:#0D47A1');
  lines.push('  classDef infrastructure fill:#FFF3E0,stroke:#E65100,color:#BF360C');
  lines.push('  classDef event fill:#FCE4EC,stroke:#C62828,color:#B71C1C');
}

// ── Subdomain-level view ────────────────────────────────────────

function addSubdomainLevelView(lines: string[], graph: DomainGraph): void {
  const subdomainEvents = new Map<string, { emits: Set<string>; consumes: Set<string> }>();

  // Aggregate emits/consumes per subdomain
  for (const [sdName, nodeKeys] of graph.subdomains) {
    const agg = { emits: new Set<string>(), consumes: new Set<string>() };
    for (const key of nodeKeys) {
      const node = graph.nodes.get(key)!;
      for (const e of node.emits) agg.emits.add(e);
      for (const e of node.consumes) agg.consumes.add(e);
    }
    subdomainEvents.set(sdName, agg);
  }

  // Add subdomain nodes
  for (const sdName of graph.subdomains.keys()) {
    const id = sanitizeId(sdName);
    const count = graph.subdomains.get(sdName)!.length;
    lines.push(`  ${id}["${sdName}\\n(${count} components)"]`);
  }

  lines.push('');

  // Add inter-subdomain event flows
  const drawnEdges = new Set<string>();
  for (const [emitterSd, emitterAgg] of subdomainEvents) {
    for (const [consumerSd, consumerAgg] of subdomainEvents) {
      if (emitterSd === consumerSd) continue;

      const sharedEvents: string[] = [];
      for (const e of emitterAgg.emits) {
        if (consumerAgg.consumes.has(e)) sharedEvents.push(e);
      }

      if (sharedEvents.length > 0) {
        const edgeKey = `${emitterSd}->${consumerSd}`;
        if (drawnEdges.has(edgeKey)) continue;
        drawnEdges.add(edgeKey);

        const fromId = sanitizeId(emitterSd);
        const toId = sanitizeId(consumerSd);
        const label =
          sharedEvents.length <= 3 ? sharedEvents.join(', ') : `${sharedEvents.length} events`;
        lines.push(`  ${fromId} -- "${label}" --> ${toId}`);
      }
    }
  }
}

// ── Detailed view ────────────────────────────────────────────────

function addDetailedView(
  lines: string[],
  graph: DomainGraph,
  opts: Required<MermaidOptions>,
): void {
  // Add subgraphs per subdomain
  for (const [sdName, nodeKeys] of graph.subdomains) {
    const subgraphId = `sd_${sanitizeId(sdName)}`;
    lines.push(`  subgraph ${subgraphId}["${sdName}"]`);

    for (const key of nodeKeys) {
      const node = graph.nodes.get(key)!;
      const nodeId = sanitizeId(key);
      const typeLabel = node.type;
      const icon = TYPE_ICONS[node.type] ?? '';
      lines.push(`    ${nodeId}["${icon} ${node.name}\\n‹${typeLabel}›"]:::${node.layer}`);
    }

    lines.push('  end');
    lines.push('');
  }

  // Event flow arrows (solid)
  addEventFlowArrows(lines, graph);

  // Dependency arrows (dashed)
  if (!opts.eventsOnly) {
    lines.push('');
    addDependencyArrows(lines, graph);
  }
}

// ── Event flow arrows ────────────────────────────────────────────

function addEventFlowArrows(lines: string[], graph: DomainGraph): void {
  lines.push('  %% Event flow');

  // Build a map: event name → consumers
  const eventConsumers = new Map<string, string[]>();
  for (const [key, node] of graph.nodes) {
    for (const e of node.consumes) {
      const consumers = eventConsumers.get(e) ?? [];
      consumers.push(key);
      eventConsumers.set(e, consumers);
    }
  }

  // For each emitter, draw arrows to consumers
  const drawnEdges = new Set<string>();
  for (const [key, node] of graph.nodes) {
    for (const eventName of node.emits) {
      const consumers = eventConsumers.get(eventName);
      if (!consumers) continue;

      for (const consumerKey of consumers) {
        const edgeId = `${key}-${eventName}-${consumerKey}`;
        if (drawnEdges.has(edgeId)) continue;
        drawnEdges.add(edgeId);

        const fromId = sanitizeId(key);
        const toId = sanitizeId(consumerKey);
        lines.push(`  ${fromId} -- "${eventName}" --> ${toId}`);
      }
    }
  }
}

// ── Dependency arrows ────────────────────────────────────────────

function addDependencyArrows(lines: string[], graph: DomainGraph): void {
  lines.push('  %% Dependencies');

  // Build a name → key lookup for matching depends by name
  const nameToKey = new Map<string, string>();
  for (const [key, node] of graph.nodes) {
    nameToKey.set(node.name, key);
  }

  for (const [key, node] of graph.nodes) {
    for (const dep of node.depends) {
      const depKey = nameToKey.get(dep);
      if (!depKey) continue; // dependency not annotated, skip

      const fromId = sanitizeId(key);
      const toId = sanitizeId(depKey);
      lines.push(`  ${fromId} -.-> ${toId}`);
    }
  }
}

// sanitizeId and TYPE_ICONS imported from event-utils.ts
