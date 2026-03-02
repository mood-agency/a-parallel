import type { DomainGraph } from '../types.js';
import { buildEventAdjacency, groupEventsByFamily } from './event-utils.js';

// ── Options ─────────────────────────────────────────────────────

export interface CatalogOptions {
  /** Include the health-check section at the bottom (default: true) */
  includeHealthCheck?: boolean;
}

// ── Main generator ──────────────────────────────────────────────

/**
 * Generate a Markdown event catalog from a DomainGraph.
 *
 * Lists all events grouped by family, with producer/consumer info,
 * cross-subdomain detection, and an optional health-check section.
 */
export function generateCatalog(graph: DomainGraph, options?: CatalogOptions): string {
  const includeHealth = options?.includeHealthCheck ?? true;
  const adj = buildEventAdjacency(graph);
  const families = groupEventsByFamily(adj.keys());

  if (adj.size === 0) {
    return '# Event Catalog\n\nNo events found in annotations.\n';
  }

  const lines: string[] = [];
  lines.push('# Event Catalog');
  lines.push('');
  lines.push(
    `> Auto-generated from \`@domain\` annotations. ${adj.size} events across ${families.size} families.`,
  );
  lines.push('');

  // ── Tables per family ──────────────────────────────────────

  const sortedFamilies = [...families.keys()].sort();

  for (const family of sortedFamilies) {
    const events = families.get(family)!;

    lines.push(`## ${family} Events`);
    lines.push('');
    lines.push('| Event | Producers | Consumers | Cross-Subdomain |');
    lines.push('|-------|-----------|-----------|:---------------:|');

    for (const eventName of events) {
      const info = adj.get(eventName)!;
      const producers = formatNodeList(graph, info.emitters);
      const consumers =
        info.consumers.length > 0 ? formatNodeList(graph, info.consumers) : '*(none)*';
      const cross = isCrossSubdomain(graph, info.emitters, info.consumers);

      lines.push(`| \`${eventName}\` | ${producers} | ${consumers} | ${cross} |`);
    }

    lines.push('');
  }

  // ── Health check ───────────────────────────────────────────

  if (includeHealth) {
    lines.push('---');
    lines.push('');
    lines.push('### Health Check');
    lines.push('');

    // Orphans: emitted but never consumed
    const orphans = [...adj.entries()]
      .filter(([, info]) => info.emitters.length > 0 && info.consumers.length === 0)
      .map(([name]) => `\`${name}\``);

    // Dead letters: consumed but never emitted
    const deadLetters = [...adj.entries()]
      .filter(([, info]) => info.consumers.length > 0 && info.emitters.length === 0)
      .map(([name]) => `\`${name}\``);

    lines.push(
      orphans.length > 0
        ? `- **Orphan events** (emitted, never consumed): ${orphans.join(', ')}`
        : '- **Orphan events**: none',
    );

    lines.push(
      deadLetters.length > 0
        ? `- **Dead-letter events** (consumed, never emitted): ${deadLetters.join(', ')}`
        : '- **Dead-letter events**: none',
    );

    // Busiest producer/consumer
    const producerCounts = new Map<string, number>();
    const consumerCounts = new Map<string, number>();

    for (const [, info] of adj) {
      for (const key of info.emitters) {
        producerCounts.set(key, (producerCounts.get(key) ?? 0) + 1);
      }
      for (const key of info.consumers) {
        consumerCounts.set(key, (consumerCounts.get(key) ?? 0) + 1);
      }
    }

    const topProducer = findTop(producerCounts);
    const topConsumer = findTop(consumerCounts);

    if (topProducer) {
      const name = graph.nodes.get(topProducer[0])?.name ?? topProducer[0];
      lines.push(`- **Busiest producer**: ${name} (${topProducer[1]} events)`);
    }

    if (topConsumer) {
      const name = graph.nodes.get(topConsumer[0])?.name ?? topConsumer[0];
      lines.push(`- **Busiest consumer**: ${name} (${topConsumer[1]} events)`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────

function formatNodeList(graph: DomainGraph, keys: string[]): string {
  return keys
    .map((key) => {
      const node = graph.nodes.get(key);
      if (!node) return key;
      return `${node.name} (${node.subdomain})`;
    })
    .join(', ');
}

function isCrossSubdomain(graph: DomainGraph, emitters: string[], consumers: string[]): string {
  if (emitters.length === 0 || consumers.length === 0) return '-';

  const emitterSubdomains = new Set(
    emitters.map((k) => graph.nodes.get(k)?.subdomain).filter(Boolean),
  );
  const consumerSubdomains = new Set(
    consumers.map((k) => graph.nodes.get(k)?.subdomain).filter(Boolean),
  );

  for (const sd of consumerSubdomains) {
    if (!emitterSubdomains.has(sd)) return 'Yes';
  }

  return 'No';
}

function findTop(counts: Map<string, number>): [string, number] | null {
  let top: [string, number] | null = null;
  for (const [key, count] of counts) {
    if (!top || count > top[1]) top = [key, count];
  }
  return top;
}
