import type { DomainGraph } from '../types.js';

/**
 * Serialize a DomainGraph to JSON for programmatic consumption.
 */
export function generateJSON(graph: DomainGraph): string {
  return JSON.stringify(
    {
      nodes: Object.fromEntries(graph.nodes),
      subdomains: Object.fromEntries([...graph.subdomains].map(([k, v]) => [k, v])),
      events: [...graph.events],
    },
    null,
    2,
  );
}
