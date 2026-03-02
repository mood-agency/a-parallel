import type { EnrichedDomainGraph, RelationshipType, SubdomainType } from '../types.js';
import { sanitizeId } from './event-utils.js';

// ── Options ──────────────────────────────────────────────────────

export interface ContextMapOptions {
  /** Diagram direction: LR (left-right) or TB (top-bottom) */
  direction?: 'LR' | 'TB';
  /** Show team ownership grouping */
  showTeams?: boolean;
}

// ── Relationship display ─────────────────────────────────────────

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  'customer-supplier': 'C/S',
  partnership: 'Partnership',
  conformist: 'Conformist',
  'published-language': 'PL',
  'anti-corruption-layer': 'ACL',
  'open-host-service': 'OHS',
  'shared-kernel': 'SK',
  'separate-ways': 'Separate Ways',
};

const RELATIONSHIP_ARROWS: Record<RelationshipType, string> = {
  'customer-supplier': '-->',
  partnership: '<-->',
  conformist: '-->',
  'published-language': '-->',
  'anti-corruption-layer': '-->',
  'open-host-service': '-->',
  'shared-kernel': '<-->',
  'separate-ways': '-.-',
};

const SUBDOMAIN_TYPE_STYLES: Record<SubdomainType, string> = {
  core: 'core',
  supporting: 'supporting',
  generic: 'generic',
};

// ── Main generator ───────────────────────────────────────────────

/**
 * Generate a Mermaid flowchart showing bounded contexts and their
 * strategic DDD relationships from a domain.yaml strategic model.
 */
export function generateContextMap(
  graph: EnrichedDomainGraph,
  options?: ContextMapOptions,
): string {
  const strategic = graph.strategic;
  if (!strategic) {
    return '%% No strategic model loaded. Use --domain-file to provide a domain.yaml.\n';
  }

  const opts: Required<ContextMapOptions> = {
    direction: options?.direction ?? 'LR',
    showTeams: options?.showTeams ?? true,
  };

  const lines: string[] = [];

  lines.push(`flowchart ${opts.direction}`);
  lines.push('');

  // Style classes for subdomain types
  addClassDefs(lines);
  lines.push('');

  // Title
  lines.push(`  %% Context Map: ${strategic.domain.name}`);
  lines.push('');

  if (opts.showTeams && strategic.teams.length > 0) {
    addTeamGroupedView(lines, graph, strategic);
  } else {
    addFlatView(lines, graph, strategic);
  }

  // Add relationship arrows
  lines.push('');
  addRelationshipArrows(lines, strategic);

  return lines.join('\n');
}

// ── Class definitions ────────────────────────────────────────────

function addClassDefs(lines: string[]): void {
  lines.push('  %% Subdomain type styles');
  lines.push('  classDef core fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20,stroke-width:3px');
  lines.push('  classDef supporting fill:#BBDEFB,stroke:#1565C0,color:#0D47A1,stroke-width:2px');
  lines.push('  classDef generic fill:#F5F5F5,stroke:#757575,color:#424242,stroke-width:1px');
  lines.push('  classDef sharedKernel fill:#FFF9C4,stroke:#F9A825,color:#F57F17,stroke-width:2px');
}

// ── Team-grouped view ────────────────────────────────────────────

function addTeamGroupedView(
  lines: string[],
  graph: EnrichedDomainGraph,
  strategic: NonNullable<EnrichedDomainGraph['strategic']>,
): void {
  // Build BC → team map
  const bcToTeam = new Map<string, string>();
  for (const team of strategic.teams) {
    for (const bc of team.owns) {
      bcToTeam.set(bc, team.name);
    }
  }

  // Group BCs by team
  const teamBCs = new Map<string, string[]>();
  for (const team of strategic.teams) {
    teamBCs.set(team.name, [...team.owns]);
  }

  // Collect unowned BCs
  const unowned: string[] = [];
  for (const [, sdDef] of strategic.subdomains) {
    if (!bcToTeam.has(sdDef.boundedContext)) {
      unowned.push(sdDef.boundedContext);
    }
  }

  // Render team subgraphs
  for (const [teamName, bcs] of teamBCs) {
    const teamId = `team_${sanitizeId(teamName)}`;
    lines.push(`  subgraph ${teamId}["Team: ${teamName}"]`);

    for (const bc of bcs) {
      addBCNode(lines, bc, graph, strategic, '    ');
    }

    lines.push('  end');
    lines.push('');
  }

  // Unowned BCs (if any)
  for (const bc of unowned) {
    addBCNode(lines, bc, graph, strategic, '  ');
  }

  // Shared Kernel
  if (strategic.sharedKernel) {
    const skId = sanitizeId(strategic.sharedKernel.name);
    const includeCount = strategic.sharedKernel.includes.length;
    lines.push(
      `  ${skId}[["${strategic.sharedKernel.name}\\n(${includeCount} shared components)"]]:::sharedKernel`,
    );
    lines.push('');
  }
}

// ── Flat view (no team grouping) ─────────────────────────────────

function addFlatView(
  lines: string[],
  graph: EnrichedDomainGraph,
  strategic: NonNullable<EnrichedDomainGraph['strategic']>,
): void {
  // Group by subdomain type
  const byType = new Map<SubdomainType, string[]>();
  for (const [, sdDef] of strategic.subdomains) {
    const list = byType.get(sdDef.type) ?? [];
    list.push(sdDef.boundedContext);
    byType.set(sdDef.type, list);
  }

  for (const sdType of ['core', 'supporting', 'generic'] as SubdomainType[]) {
    const bcs = byType.get(sdType);
    if (!bcs || bcs.length === 0) continue;

    const groupId = `group_${sdType}`;
    lines.push(`  subgraph ${groupId}["${sdType.toUpperCase()} Domain"]`);

    for (const bc of bcs) {
      addBCNode(lines, bc, graph, strategic, '    ');
    }

    lines.push('  end');
    lines.push('');
  }

  // Shared Kernel
  if (strategic.sharedKernel) {
    const skId = sanitizeId(strategic.sharedKernel.name);
    const includeCount = strategic.sharedKernel.includes.length;
    lines.push(
      `  ${skId}[["${strategic.sharedKernel.name}\\n(${includeCount} shared components)"]]:::sharedKernel`,
    );
    lines.push('');
  }
}

// ── Node rendering ───────────────────────────────────────────────

function addBCNode(
  lines: string[],
  bcName: string,
  graph: EnrichedDomainGraph,
  strategic: NonNullable<EnrichedDomainGraph['strategic']>,
  indent: string,
): void {
  // Find subdomain definition for this BC
  let sdDef = null;
  for (const [, def] of strategic.subdomains) {
    if (def.boundedContext === bcName) {
      sdDef = def;
      break;
    }
  }

  const nodeId = sanitizeId(bcName);
  const sdType = sdDef ? SUBDOMAIN_TYPE_STYLES[sdDef.type] : 'generic';

  // Count components from tactical annotations
  const componentCount = sdDef ? (graph.subdomains.get(sdDef.name)?.length ?? 0) : 0;

  const label =
    componentCount > 0
      ? `${bcName}\\n‹${sdDef?.type ?? 'unknown'}›\\n(${componentCount} components)`
      : `${bcName}\\n‹${sdDef?.type ?? 'unknown'}›`;

  lines.push(`${indent}${nodeId}["${label}"]:::${sdType}`);
}

// ── Relationship arrows ──────────────────────────────────────────

function addRelationshipArrows(
  lines: string[],
  strategic: NonNullable<EnrichedDomainGraph['strategic']>,
): void {
  lines.push('  %% Strategic relationships');

  for (const rel of strategic.contextMap) {
    const label = RELATIONSHIP_LABELS[rel.relationship];
    const arrow = RELATIONSHIP_ARROWS[rel.relationship];

    // Handle wildcard downstream
    if (rel.downstream === '*') {
      // Draw to all BCs (skip self)
      for (const [, sdDef] of strategic.subdomains) {
        if (sdDef.boundedContext === rel.upstream) continue;
        const fromId = sanitizeId(rel.upstream);
        const toId = sanitizeId(sdDef.boundedContext);
        lines.push(`  ${fromId} ${arrow} |"${label}"| ${toId}`);
      }
      continue;
    }

    const fromId = sanitizeId(rel.upstream);
    const toId = sanitizeId(rel.downstream);

    // Build label with roles if present
    let edgeLabel = label;
    if (rel.upstreamRole || rel.downstreamRole) {
      const uRole = rel.upstreamRole ? `[${rel.upstreamRole[0].toUpperCase()}]` : '';
      const dRole = rel.downstreamRole ? `[${rel.downstreamRole[0].toUpperCase()}]` : '';
      edgeLabel = `${uRole} ${label} ${dRole}`.trim();
    }

    if (rel.via) {
      edgeLabel += ` via ${rel.via}`;
    }

    lines.push(`  ${fromId} ${arrow} |"${edgeLabel}"| ${toId}`);
  }
}
