#!/usr/bin/env bun

import { resolve } from 'path';

import { generateJSON } from './generators/json.js';
import { generateMermaid } from './generators/mermaid.js';
import { parseDirectory } from './parser.js';
import type { CLIOptions, DomainType, DomainGraph } from './types.js';

// ── Argument parsing ─────────────────────────────────────────────

function parseArgs(argv: string[]): CLIOptions {
  const options: CLIOptions = {
    dir: process.cwd(),
    format: 'mermaid',
    eventsOnly: false,
    direction: 'LR',
  };

  const filterContext: string[] = [];
  const filterType: DomainType[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;

      case '--output':
      case '-o':
        options.output = argv[++i];
        break;

      case '--format':
      case '-f':
        options.format = argv[++i] as 'mermaid' | 'json';
        break;

      case '--context':
      case '-c':
        filterContext.push(argv[++i]);
        break;

      case '--type':
      case '-t':
        filterType.push(argv[++i] as DomainType);
        break;

      case '--events-only':
        options.eventsOnly = true;
        break;

      case '--direction':
        options.direction = argv[++i] as 'LR' | 'TB';
        break;

      default:
        // Positional argument: directory
        if (!arg.startsWith('-')) {
          options.dir = arg;
        } else {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }

    i++;
  }

  if (filterContext.length > 0) options.filterContext = filterContext;
  if (filterType.length > 0) options.filterType = filterType;

  return options;
}

function printHelp(): void {
  console.log(`
domain-map — Parse @domain annotations and generate architecture diagrams

Usage:
  bun packages/domain-map/src/cli.ts [options] [directory]

Options:
  --output, -o <file>       Write output to file (default: stdout)
  --format, -f <format>     Output format: mermaid | json (default: mermaid)
  --context, -c <name>      Filter by bounded context (repeatable)
  --type, -t <type>         Filter by DDD type (repeatable)
  --events-only             Show only event flow arrows
  --direction <dir>         Mermaid direction: LR | TB (default: LR)
  --help, -h                Show this help

Examples:
  bun packages/domain-map/src/cli.ts packages/server/src
  bun packages/domain-map/src/cli.ts --format json packages/
  bun packages/domain-map/src/cli.ts --context "Git Operations" --context "Agent Execution" packages/server/src
  bun packages/domain-map/src/cli.ts --type handler --type domain-service packages/server/src
  bun packages/domain-map/src/cli.ts --events-only --direction TB packages/server/src
`);
}

// ── Filtering ────────────────────────────────────────────────────

function applyFilters(graph: DomainGraph, options: CLIOptions): DomainGraph {
  if (!options.filterContext && !options.filterType) return graph;

  const filtered: DomainGraph = {
    nodes: new Map(),
    contexts: new Map(),
    events: new Set(),
  };

  for (const [key, node] of graph.nodes) {
    if (options.filterContext && !options.filterContext.includes(node.context)) continue;
    if (options.filterType && !options.filterType.includes(node.type)) continue;

    filtered.nodes.set(key, node);

    const contextMembers = filtered.contexts.get(node.context) ?? [];
    contextMembers.push(key);
    filtered.contexts.set(node.context, contextMembers);

    if (node.event) filtered.events.add(node.event);
    for (const e of node.emits) filtered.events.add(e);
    for (const e of node.consumes) filtered.events.add(e);
  }

  return filtered;
}

// ── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const options = parseArgs(args);

  const dir = resolve(options.dir);
  console.error(`Scanning ${dir} for @domain annotations...`);

  const graph = await parseDirectory(dir);
  const filtered = applyFilters(graph, options);

  const nodeCount = filtered.nodes.size;
  const contextCount = filtered.contexts.size;
  console.error(`Found ${nodeCount} annotated components in ${contextCount} bounded contexts.`);

  if (nodeCount === 0) {
    console.error('No @domain annotations found. Use /domain-annotate to add them.');
    process.exit(0);
  }

  let output: string;
  if (options.format === 'json') {
    output = generateJSON(filtered);
  } else {
    output = generateMermaid(filtered, {
      direction: options.direction,
      eventsOnly: options.eventsOnly,
    });
  }

  if (options.output) {
    await Bun.write(options.output, output);
    console.error(`Output written to ${options.output}`);
  } else {
    console.log(output);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
