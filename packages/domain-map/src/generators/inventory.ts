import type { DomainGraph, EnrichedDomainGraph, DomainAnnotation } from '../types.js';

// ── Options ─────────────────────────────────────────────────────

export interface InventoryOptions {}

// ── Main generator ──────────────────────────────────────────────

/**
 * Generate a Markdown inventory showing which files implement each subdomain.
 *
 * Groups files by subdomain, then by DDD type within each subdomain.
 * When a strategic model is present, shows bounded-context and subdomain type.
 */
export function generateInventory(graph: DomainGraph, _options?: InventoryOptions): string {
  const enriched = graph as EnrichedDomainGraph;
  const strategic = enriched.strategic;

  if (graph.nodes.size === 0) {
    return '# Domain Inventory\n\nNo annotated components found.\n';
  }

  const lines: string[] = [];
  lines.push('# Domain Inventory');
  lines.push('');
  lines.push(`> ${graph.nodes.size} components across ${graph.subdomains.size} subdomains`);
  lines.push('');

  // Sort subdomains: core first, then supporting, then generic, then rest
  const typeOrder: Record<string, number> = { core: 0, supporting: 1, generic: 2 };
  const sortedSubdomains = [...graph.subdomains.keys()].sort((a, b) => {
    const aDef = strategic?.subdomains.get(a);
    const bDef = strategic?.subdomains.get(b);
    const aOrder = typeOrder[aDef?.type ?? ''] ?? 3;
    const bOrder = typeOrder[bDef?.type ?? ''] ?? 3;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.localeCompare(b);
  });

  for (const subdomain of sortedSubdomains) {
    const nodeKeys = graph.subdomains.get(subdomain) ?? [];
    const nodes = nodeKeys
      .map((k) => graph.nodes.get(k))
      .filter((n): n is DomainAnnotation => n !== undefined);

    if (nodes.length === 0) continue;

    // Header with strategic info
    const def = strategic?.subdomains.get(subdomain);
    const typeBadge = def?.type ?? nodes[0]?.subdomainType ?? '';
    const bc = def?.boundedContext ?? '';
    const header = [subdomain];
    if (typeBadge) header.push(`(${typeBadge})`);
    if (bc) header.push(`\u2014 ${bc}`);

    lines.push(`## ${header.join(' ')}`);
    lines.push('');

    // Group by DDD type
    const byType = new Map<string, DomainAnnotation[]>();
    for (const node of nodes) {
      const group = byType.get(node.type) ?? [];
      group.push(node);
      byType.set(node.type, group);
    }

    // Sort types in logical order
    const sortedTypes = [...byType.keys()].sort((a, b) => {
      const order = typeRank(a) - typeRank(b);
      return order !== 0 ? order : a.localeCompare(b);
    });

    for (const type of sortedTypes) {
      const members = byType.get(type)!;
      lines.push(`**${type}**`);
      for (const node of members.sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = node.filePath.replace(/\\/g, '/');
        const extras: string[] = [];
        if (node.emits.length > 0) extras.push(`emits: ${node.emits.join(', ')}`);
        if (node.consumes.length > 0) extras.push(`consumes: ${node.consumes.join(', ')}`);
        const suffix = extras.length > 0 ? ` *(${extras.join(' | ')})*` : '';
        lines.push(`- \`${rel}\` \u2014 ${node.name}${suffix}`);
      }
      lines.push('');
    }
  }

  // Summary table
  lines.push('---');
  lines.push('');
  lines.push('### Summary');
  lines.push('');
  lines.push('| Subdomain | Type | BC | Files |');
  lines.push('|-----------|------|----|------:|');

  for (const subdomain of sortedSubdomains) {
    const count = graph.subdomains.get(subdomain)?.length ?? 0;
    const def = strategic?.subdomains.get(subdomain);
    const type = def?.type ?? '';
    const bc = def?.boundedContext ?? '';
    lines.push(`| ${subdomain} | ${type} | ${bc} | ${count} |`);
  }

  lines.push('');
  return lines.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────

/** Rank DDD types for display ordering */
function typeRank(type: string): number {
  const ranks: Record<string, number> = {
    'aggregate-root': 0,
    entity: 1,
    'value-object': 2,
    'domain-event': 3,
    'domain-service': 4,
    'app-service': 5,
    repository: 6,
    factory: 7,
    policy: 8,
    handler: 9,
    port: 10,
    adapter: 11,
    'event-bus': 12,
    module: 13,
  };
  return ranks[type] ?? 99;
}
