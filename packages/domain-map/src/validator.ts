import type { DomainGraph, StrategicModel, ValidationWarning } from './types.js';

/**
 * Cross-validate a strategic model against tactical annotations.
 * Returns warnings for mismatches, orphans, and inconsistencies.
 */
export function validateConsistency(
  graph: DomainGraph,
  strategic: StrategicModel,
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Collect all annotated subdomain names
  const annotatedSubdomains = new Set(graph.subdomains.keys());

  // Collect all annotated events (from emits/consumes)
  const annotatedEvents = graph.events;

  // Collect all annotated aggregate roots
  const annotatedAggregates = new Set<string>();
  for (const [, node] of graph.nodes) {
    if (node.type === 'aggregate-root') {
      annotatedAggregates.add(node.name);
    }
  }

  // 1. Subdomains in YAML but not in code annotations
  for (const [sdName] of strategic.subdomains) {
    if (!annotatedSubdomains.has(sdName)) {
      warnings.push({
        severity: 'warning',
        code: 'YAML_SUBDOMAIN_NO_ANNOTATIONS',
        message: `Subdomain "${sdName}" defined in YAML but no @domain annotations found in code.`,
        source: 'cross',
      });
    }
  }

  // 2. Subdomains in code but not in YAML
  for (const sdName of annotatedSubdomains) {
    if (!strategic.subdomains.has(sdName)) {
      // Skip Shared Kernel — it's defined separately
      if (strategic.sharedKernel && strategic.sharedKernel.name === sdName) continue;

      warnings.push({
        severity: 'warning',
        code: 'ANNOTATION_SUBDOMAIN_NOT_IN_YAML',
        message: `Subdomain "${sdName}" found in code annotations but not defined in YAML.`,
        source: 'cross',
      });
    }
  }

  // 3. Subdomain type mismatches
  for (const [, node] of graph.nodes) {
    if (!node.subdomainType) continue;
    const sdDef = strategic.subdomains.get(node.subdomain);
    if (!sdDef) continue;

    if (node.subdomainType !== sdDef.type) {
      warnings.push({
        severity: 'warning',
        code: 'SUBDOMAIN_TYPE_MISMATCH',
        message: `"${node.name}" in "${node.subdomain}": annotation says "${node.subdomainType}" but YAML says "${sdDef.type}".`,
        source: 'cross',
      });
    }
  }

  // 4. Events in YAML publishes but never emitted in code
  for (const [sdName, sdDef] of strategic.subdomains) {
    for (const event of sdDef.publishes) {
      // Check if any node in this subdomain emits this event
      const nodeKeys = graph.subdomains.get(sdName) ?? [];
      const emitted = nodeKeys.some((key) => {
        const node = graph.nodes.get(key);
        return node && node.emits.includes(event);
      });

      if (!emitted && !annotatedEvents.has(event)) {
        warnings.push({
          severity: 'warning',
          code: 'YAML_EVENT_NOT_EMITTED',
          message: `Event "${event}" in YAML publishes for "${sdName}" is never emitted in code annotations.`,
          source: 'cross',
        });
      }
    }
  }

  // 5. Aggregates in YAML but no matching aggregate-root in code
  for (const [sdName, sdDef] of strategic.subdomains) {
    for (const agg of sdDef.aggregates) {
      if (!annotatedAggregates.has(agg)) {
        warnings.push({
          severity: 'warning',
          code: 'YAML_AGGREGATE_NO_ANNOTATION',
          message: `Aggregate "${agg}" in YAML for "${sdName}" has no @domain type: aggregate-root annotation in code.`,
          source: 'cross',
        });
      }
    }
  }

  // 6. Context map references to undefined bounded contexts
  const allBCs = new Set<string>();
  for (const [, sdDef] of strategic.subdomains) {
    allBCs.add(sdDef.boundedContext);
  }

  for (const rel of strategic.contextMap) {
    if (rel.upstream !== '*' && !allBCs.has(rel.upstream)) {
      warnings.push({
        severity: 'error',
        code: 'CONTEXT_MAP_UNKNOWN_BC',
        message: `Context map references unknown bounded context "${rel.upstream}" as upstream.`,
        source: 'yaml',
      });
    }
    if (rel.downstream !== '*' && !allBCs.has(rel.downstream)) {
      warnings.push({
        severity: 'error',
        code: 'CONTEXT_MAP_UNKNOWN_BC',
        message: `Context map references unknown bounded context "${rel.downstream}" as downstream.`,
        source: 'yaml',
      });
    }
  }

  // 7. Teams referencing undefined bounded contexts
  for (const team of strategic.teams) {
    for (const bc of team.owns) {
      if (!allBCs.has(bc)) {
        warnings.push({
          severity: 'error',
          code: 'TEAM_UNKNOWN_BC',
          message: `Team "${team.name}" owns unknown bounded context "${bc}".`,
          source: 'yaml',
        });
      }
    }
  }

  // 8. Bounded contexts not owned by any team
  const ownedBCs = new Set<string>();
  for (const team of strategic.teams) {
    for (const bc of team.owns) ownedBCs.add(bc);
  }
  for (const bc of allBCs) {
    if (!ownedBCs.has(bc)) {
      warnings.push({
        severity: 'warning',
        code: 'BC_NO_TEAM',
        message: `Bounded context "${bc}" is not owned by any team.`,
        source: 'yaml',
      });
    }
  }

  return warnings;
}
