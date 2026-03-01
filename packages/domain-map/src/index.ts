export type {
  DomainAnnotation,
  DomainGraph,
  DomainType,
  DomainLayer,
  CLIOptions,
} from './types.js';

export { parseFile, parseDirectory, buildGraph } from './parser.js';
export { generateMermaid, type MermaidOptions } from './generators/mermaid.js';
export { generateJSON } from './generators/json.js';
