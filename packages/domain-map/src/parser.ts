import { resolve, basename, relative } from 'path';

import { Glob } from 'bun';

import type { DomainAnnotation, DomainGraph, DomainType, DomainLayer } from './types.js';

// ── Constants ────────────────────────────────────────────────────

const DOMAIN_TAG_REGEX = /@domain\s+([\w-]+)\s*:\s*(.+)/g;
const JSDOC_BLOCK_REGEX = /\/\*\*[\s\S]*?\*\//g;
const EXPORT_NAME_REGEX = /export\s+(?:default\s+)?(?:class|interface|type|function|const)\s+(\w+)/;

const CSV_FIELDS = new Set(['emits', 'consumes', 'depends']);
const REQUIRED_FIELDS = new Set(['context', 'type', 'layer']);

const VALID_TYPES = new Set<DomainType>([
  // Strategic
  'bounded-context',
  'anti-corruption-layer',
  'published-language',
  'context-map',
  // Tactical
  'aggregate-root',
  'entity',
  'value-object',
  'domain-event',
  'domain-service',
  'app-service',
  'repository',
  'factory',
  'specification',
  'policy',
  'module',
  // Architectural
  'port',
  'adapter',
  'event-bus',
  'handler',
]);

const VALID_LAYERS = new Set<DomainLayer>(['domain', 'application', 'infrastructure']);

// ── parseFile ────────────────────────────────────────────────────

/**
 * Parse a single file's content and return all @domain annotation blocks found.
 */
export function parseFile(filePath: string, content: string): DomainAnnotation[] {
  const annotations: DomainAnnotation[] = [];
  const blocks = content.matchAll(JSDOC_BLOCK_REGEX);

  for (const blockMatch of blocks) {
    const block = blockMatch[0];
    if (!block.includes('@domain')) continue;

    const tags = extractTags(block);
    if (!tags) continue;

    // Validate required fields
    const missing = [...REQUIRED_FIELDS].filter((f) => !(f in tags));
    if (missing.length > 0) {
      console.error(
        `[domain-map] Warning: ${filePath} — @domain block missing required tags: ${missing.join(', ')}. Skipping.`,
      );
      continue;
    }

    // Validate type value
    if (!VALID_TYPES.has(tags.type as DomainType)) {
      console.error(
        `[domain-map] Warning: ${filePath} — invalid @domain type: "${tags.type}". Skipping.`,
      );
      continue;
    }

    // Validate layer value
    if (!VALID_LAYERS.has(tags.layer as DomainLayer)) {
      console.error(
        `[domain-map] Warning: ${filePath} — invalid @domain layer: "${tags.layer}". Skipping.`,
      );
      continue;
    }

    // Determine the name of the annotated export
    const name = resolveExportName(content, blockMatch.index! + block.length, filePath);

    annotations.push({
      filePath,
      name,
      context: tags.context!,
      type: tags.type as DomainType,
      layer: tags.layer as DomainLayer,
      event: tags.event,
      emits: tags.emits ? parseCSV(tags.emits) : [],
      consumes: tags.consumes ? parseCSV(tags.consumes) : [],
      aggregate: tags.aggregate,
      depends: tags.depends ? parseCSV(tags.depends) : [],
    });
  }

  return annotations;
}

// ── parseDirectory ───────────────────────────────────────────────

/**
 * Scan a directory recursively for .ts files and parse all @domain annotations.
 */
export async function parseDirectory(dir: string): Promise<DomainGraph> {
  const absDir = resolve(dir);
  const glob = new Glob('**/*.ts');
  const annotations: DomainAnnotation[] = [];

  for await (const path of glob.scan({ cwd: absDir, absolute: true })) {
    // Skip non-source files
    const rel = relative(absDir, path);
    if (shouldSkip(rel)) continue;

    const file = Bun.file(path);
    const content = await file.text();
    const fileAnnotations = parseFile(rel, content);
    annotations.push(...fileAnnotations);
  }

  return buildGraph(annotations);
}

// ── buildGraph ───────────────────────────────────────────────────

/**
 * Build a DomainGraph from an array of DomainAnnotations.
 */
export function buildGraph(annotations: DomainAnnotation[]): DomainGraph {
  const nodes = new Map<string, DomainAnnotation>();
  const contexts = new Map<string, string[]>();
  const events = new Set<string>();

  for (const annotation of annotations) {
    const key = `${annotation.context}::${annotation.name}`;

    nodes.set(key, annotation);

    // Group by context
    const contextMembers = contexts.get(annotation.context) ?? [];
    contextMembers.push(key);
    contexts.set(annotation.context, contextMembers);

    // Collect all event names
    if (annotation.event) events.add(annotation.event);
    for (const e of annotation.emits) events.add(e);
    for (const e of annotation.consumes) events.add(e);
  }

  return { nodes, contexts, events };
}

// ── Helpers ──────────────────────────────────────────────────────

function extractTags(block: string): Record<string, string> | null {
  const tags: Record<string, string> = {};
  let hasAny = false;

  // Reset regex lastIndex for each block
  const regex = new RegExp(DOMAIN_TAG_REGEX.source, DOMAIN_TAG_REGEX.flags);
  for (const match of block.matchAll(regex)) {
    const key = match[1];
    const value = match[2].trim();
    tags[key] = value;
    hasAny = true;
  }

  return hasAny ? tags : null;
}

function parseCSV(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveExportName(content: string, afterIndex: number, filePath: string): string {
  // Look at the text after the JSDoc block for the nearest export declaration
  const rest = content.slice(afterIndex, afterIndex + 500);
  const lines = rest.split('\n');

  // Check the first 10 non-empty lines after the JSDoc block.
  // If we hit an import statement before an export, this is a file-level JSDoc → use filename.
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//') || line.startsWith('*')) continue;

    // If we hit an import before any export, this is a file-level annotation
    if (line.startsWith('import ')) {
      break;
    }

    const match = line.match(EXPORT_NAME_REGEX);
    if (match) return match[1];
  }

  // Fallback: use filename stem
  const stem = basename(filePath).replace(/\.[^.]+$/, '');
  return stem;
}

function shouldSkip(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.includes('node_modules/')) return true;
  if (normalized.includes('dist/')) return true;
  if (normalized.endsWith('.test.ts')) return true;
  if (normalized.endsWith('.spec.ts')) return true;
  if (normalized.endsWith('.stories.ts')) return true;
  if (normalized.endsWith('.stories.tsx')) return true;
  if (normalized.endsWith('.d.ts')) return true;
  return false;
}
