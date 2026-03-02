import { parse as parseYAML } from 'yaml';

import type {
  ContextRelationship,
  RelationshipType,
  SharedKernelDefinition,
  StrategicModel,
  SubdomainDefinition,
  SubdomainType,
  TeamDefinition,
} from './types.js';

// ── Constants ────────────────────────────────────────────────────

const VALID_RELATIONSHIP_TYPES = new Set<RelationshipType>([
  'customer-supplier',
  'partnership',
  'conformist',
  'published-language',
  'anti-corruption-layer',
  'open-host-service',
  'shared-kernel',
  'separate-ways',
]);

const VALID_SUBDOMAIN_TYPES = new Set<SubdomainType>(['core', 'supporting', 'generic']);

// ── Public API ───────────────────────────────────────────────────

/**
 * Parse a domain.yaml file and return a validated StrategicModel.
 */
export async function parseStrategicFile(filePath: string): Promise<StrategicModel> {
  const content = await Bun.file(filePath).text();
  return parseStrategicYAML(content, filePath);
}

/**
 * Parse YAML content string into a StrategicModel.
 */
export function parseStrategicYAML(content: string, source = '<inline>'): StrategicModel {
  const doc = parseYAML(content) as Record<string, unknown>;

  if (!doc || typeof doc !== 'object') {
    throw new Error(`[domain-map] ${source}: YAML must be an object`);
  }

  return {
    domain: parseDomain(doc, source),
    subdomains: parseSubdomains(doc, source),
    sharedKernel: parseSharedKernel(doc),
    contextMap: parseContextMap(doc, source),
    teams: parseTeams(doc),
  };
}

// ── Parsers ──────────────────────────────────────────────────────

function parseDomain(
  doc: Record<string, unknown>,
  source: string,
): { name: string; description?: string } {
  const raw = doc.domain as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object' || !raw.name) {
    throw new Error(`[domain-map] ${source}: missing required field "domain.name"`);
  }
  return {
    name: String(raw.name),
    description: raw.description ? String(raw.description).trim() : undefined,
  };
}

function parseSubdomains(
  doc: Record<string, unknown>,
  source: string,
): Map<string, SubdomainDefinition> {
  const raw = doc.subdomains as Record<string, Record<string, unknown>> | undefined;
  if (!raw || typeof raw !== 'object') {
    throw new Error(`[domain-map] ${source}: missing required field "subdomains"`);
  }

  const result = new Map<string, SubdomainDefinition>();

  for (const [name, def] of Object.entries(raw)) {
    if (!def || typeof def !== 'object') {
      console.error(`[domain-map] ${source}: subdomain "${name}" must be an object. Skipping.`);
      continue;
    }

    const sdType = String(def.type ?? '');
    if (!VALID_SUBDOMAIN_TYPES.has(sdType as SubdomainType)) {
      console.error(
        `[domain-map] ${source}: subdomain "${name}" has invalid type "${sdType}". Skipping.`,
      );
      continue;
    }

    const bc = def['bounded-context'] as string | undefined;
    if (!bc) {
      console.error(
        `[domain-map] ${source}: subdomain "${name}" missing "bounded-context". Skipping.`,
      );
      continue;
    }

    result.set(name, {
      name,
      type: sdType as SubdomainType,
      description: def.description ? String(def.description).trim() : undefined,
      boundedContext: String(bc),
      aggregates: toStringArray(def.aggregates),
      publishes: toStringArray(def.publishes),
      exposes: toStringArray(def.exposes),
    });
  }

  return result;
}

function parseSharedKernel(doc: Record<string, unknown>): SharedKernelDefinition | undefined {
  const raw = doc['shared-kernel'] as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return undefined;

  return {
    name: String(raw.name ?? 'Shared Kernel'),
    description: raw.description ? String(raw.description).trim() : undefined,
    includes: toStringArray(raw.includes),
  };
}

function parseContextMap(doc: Record<string, unknown>, source: string): ContextRelationship[] {
  const raw = doc['context-map'] as Array<Record<string, unknown>> | undefined;
  if (!raw || !Array.isArray(raw)) return [];

  const result: ContextRelationship[] = [];

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== 'object') continue;

    const upstream = entry.upstream as string | undefined;
    const downstream = entry.downstream as string | undefined;
    const relationship = entry.relationship as string | undefined;

    if (!upstream || !downstream || !relationship) {
      console.error(
        `[domain-map] ${source}: context-map[${i}] missing upstream, downstream, or relationship. Skipping.`,
      );
      continue;
    }

    if (!VALID_RELATIONSHIP_TYPES.has(relationship as RelationshipType)) {
      console.error(
        `[domain-map] ${source}: context-map[${i}] invalid relationship "${relationship}". Skipping.`,
      );
      continue;
    }

    result.push({
      upstream: String(upstream),
      downstream: String(downstream),
      relationship: relationship as RelationshipType,
      upstreamRole: entry['upstream-role'] as 'supplier' | 'customer' | undefined,
      downstreamRole: entry['downstream-role'] as 'supplier' | 'customer' | undefined,
      via: entry.via ? String(entry.via) : undefined,
      description: entry.description ? String(entry.description).trim() : undefined,
      implementedBy: toStringArray(entry['implemented-by']),
    });
  }

  return result;
}

function parseTeams(doc: Record<string, unknown>): TeamDefinition[] {
  const raw = doc.teams as Record<string, Record<string, unknown>> | undefined;
  if (!raw || typeof raw !== 'object') return [];

  const result: TeamDefinition[] = [];

  for (const [name, def] of Object.entries(raw)) {
    if (!def || typeof def !== 'object') continue;

    result.push({
      name,
      description: def.description ? String(def.description).trim() : undefined,
      owns: toStringArray(def.owns),
      contact: def.contact ? String(def.contact) : undefined,
    });
  }

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────

function toStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string')
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}
