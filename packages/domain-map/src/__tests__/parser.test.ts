import { describe, test, expect } from 'bun:test';

import { parseFile, buildGraph } from '../parser.js';
import type { DomainAnnotation } from '../types.js';

// Helper: build a JSDoc block with @domain tags
function domainBlock(tags: Record<string, string>): string {
  const lines = ['/**'];
  for (const [key, val] of Object.entries(tags)) {
    lines.push(' * @domain ' + key + ': ' + val);
  }
  lines.push(' */');
  return lines.join('\n');
}

// Helper: build annotated source content
function annotatedSource(tags: Record<string, string>, exportLine?: string): string {
  const block = domainBlock(tags);
  return exportLine ? block + '\n' + exportLine : block;
}

describe('parseFile', () => {
  test('parses a valid @domain annotation block with all required fields', () => {
    const src = annotatedSource(
      { context: 'ThreadManagement', type: 'app-service', layer: 'application' },
      'export class ThreadService {}',
    );
    const result = parseFile('thread-service.ts', src);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('thread-service.ts');
    expect(result[0].name).toBe('ThreadService');
    expect(result[0].context).toBe('ThreadManagement');
    expect(result[0].type).toBe('app-service');
    expect(result[0].layer).toBe('application');
    expect(result[0].emits).toEqual([]);
    expect(result[0].consumes).toEqual([]);
    expect(result[0].depends).toEqual([]);
  });

  test('parses CSV fields (emits, consumes, depends) correctly', () => {
    const src = annotatedSource(
      {
        context: 'ThreadManagement',
        type: 'app-service',
        layer: 'application',
        emits: 'thread:created, thread:updated',
        consumes: 'project:deleted, user:logged-in',
        depends: 'ThreadRepository, EventBus',
      },
      'export class ThreadService {}',
    );
    const result = parseFile('thread-service.ts', src);
    expect(result).toHaveLength(1);
    expect(result[0].emits).toEqual(['thread:created', 'thread:updated']);
    expect(result[0].consumes).toEqual(['project:deleted', 'user:logged-in']);
    expect(result[0].depends).toEqual(['ThreadRepository', 'EventBus']);
  });

  test('skips blocks without @domain tags', () => {
    const src = [
      '/**',
      ' * A regular JSDoc comment.',
      ' * @param name - the user name',
      ' */',
      'export function greet(name: string): string {',
      '  return "Hello";',
      '}',
    ].join('\n');
    const result = parseFile('greet.ts', src);
    expect(result).toHaveLength(0);
  });

  test('skips blocks with missing required fields (no context)', () => {
    const src = annotatedSource(
      { type: 'app-service', layer: 'application' },
      'export class Incomplete {}',
    );
    const result = parseFile('incomplete.ts', src);
    expect(result).toHaveLength(0);
  });

  test('skips blocks with missing required fields (no type)', () => {
    const src = annotatedSource(
      { context: 'ThreadManagement', layer: 'application' },
      'export class Incomplete {}',
    );
    const result = parseFile('incomplete.ts', src);
    expect(result).toHaveLength(0);
  });

  test('skips blocks with missing required fields (no layer)', () => {
    const src = annotatedSource(
      { context: 'ThreadManagement', type: 'app-service' },
      'export class Incomplete {}',
    );
    const result = parseFile('incomplete.ts', src);
    expect(result).toHaveLength(0);
  });

  test('skips blocks with invalid type value', () => {
    const src = annotatedSource(
      { context: 'ThreadManagement', type: 'not-a-real-type', layer: 'application' },
      'export class Invalid {}',
    );
    const result = parseFile('invalid.ts', src);
    expect(result).toHaveLength(0);
  });

  test('skips blocks with invalid layer value', () => {
    const src = annotatedSource(
      { context: 'ThreadManagement', type: 'app-service', layer: 'presentation' },
      'export class Invalid {}',
    );
    const result = parseFile('invalid.ts', src);
    expect(result).toHaveLength(0);
  });

  test('parses multiple annotation blocks in a single file', () => {
    const blocks = [
      annotatedSource(
        { context: 'Git', type: 'repository', layer: 'infrastructure' },
        'export class GitRepository {}',
      ),
      '',
      annotatedSource(
        { context: 'Git', type: 'domain-service', layer: 'domain' },
        'export class GitDiffCalculator {}',
      ),
      '',
      annotatedSource(
        { context: 'ThreadManagement', type: 'app-service', layer: 'application' },
        'export class ThreadService {}',
      ),
    ].join('\n');
    const result = parseFile('services.ts', blocks);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('GitRepository');
    expect(result[0].context).toBe('Git');
    expect(result[0].type).toBe('repository');
    expect(result[0].layer).toBe('infrastructure');
    expect(result[1].name).toBe('GitDiffCalculator');
    expect(result[1].context).toBe('Git');
    expect(result[1].type).toBe('domain-service');
    expect(result[1].layer).toBe('domain');
    expect(result[2].name).toBe('ThreadService');
    expect(result[2].context).toBe('ThreadManagement');
    expect(result[2].type).toBe('app-service');
    expect(result[2].layer).toBe('application');
  });

  test('resolves export name from the line after the JSDoc block', () => {
    const src = annotatedSource(
      { context: 'Auth', type: 'adapter', layer: 'infrastructure' },
      'export const AuthAdapter = {};',
    );
    const result = parseFile('auth-adapter.ts', src);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('AuthAdapter');
  });

  test('resolves export name for interface export form', () => {
    const src = annotatedSource(
      { context: 'Auth', type: 'port', layer: 'domain' },
      'export interface AuthPort {}',
    );
    const result = parseFile('auth-port.ts', src);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('AuthPort');
  });

  test('falls back to filename stem when no export follows', () => {
    const block = domainBlock({ context: 'Config', type: 'module', layer: 'infrastructure' });
    const src = block + '\n\nimport { something } from "./other";\n\nconst internal = 42;';
    const result = parseFile('config-loader.ts', src);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('config-loader');
  });

  test('falls back to filename stem when block is at end of file', () => {
    const src = domainBlock({ context: 'Config', type: 'module', layer: 'infrastructure' });
    const result = parseFile('path/to/my-module.ts', src);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('my-module');
  });

  test('parses optional event and aggregate fields', () => {
    const src = annotatedSource(
      {
        context: 'Orders',
        type: 'domain-event',
        layer: 'domain',
        event: 'order:placed',
        aggregate: 'Order',
      },
      'export interface OrderPlacedEvent {}',
    );
    const result = parseFile('order-placed.ts', src);
    expect(result).toHaveLength(1);
    expect(result[0].event).toBe('order:placed');
    expect(result[0].aggregate).toBe('Order');
  });
});

// ── buildGraph ─────────────────────────────────────────────────────

describe('buildGraph', () => {
  function makeAnnotation(overrides: Partial<DomainAnnotation> = {}): DomainAnnotation {
    return {
      filePath: 'test.ts',
      name: 'TestService',
      context: 'TestContext',
      type: 'app-service',
      layer: 'application',
      emits: [],
      consumes: [],
      depends: [],
      ...overrides,
    };
  }

  test('builds a graph from an array of annotations', () => {
    const annotations: DomainAnnotation[] = [
      makeAnnotation({ name: 'ServiceA', context: 'CtxA' }),
      makeAnnotation({ name: 'ServiceB', context: 'CtxB' }),
    ];
    const graph = buildGraph(annotations);
    expect(graph.nodes.size).toBe(2);
    expect(graph.contexts.size).toBe(2);
    expect(graph.nodes.has('CtxA::ServiceA')).toBe(true);
    expect(graph.nodes.has('CtxB::ServiceB')).toBe(true);
  });

  test('groups annotations by context', () => {
    const annotations: DomainAnnotation[] = [
      makeAnnotation({ name: 'ServiceA', context: 'Shared' }),
      makeAnnotation({ name: 'ServiceB', context: 'Shared' }),
      makeAnnotation({ name: 'ServiceC', context: 'Other' }),
    ];
    const graph = buildGraph(annotations);
    expect(graph.contexts.size).toBe(2);
    expect(graph.contexts.get('Shared')).toEqual(['Shared::ServiceA', 'Shared::ServiceB']);
    expect(graph.contexts.get('Other')).toEqual(['Other::ServiceC']);
  });

  test('collects all unique event names from emits, consumes, and event fields', () => {
    const annotations: DomainAnnotation[] = [
      makeAnnotation({
        name: 'Producer',
        context: 'CtxA',
        emits: ['event:one', 'event:two'],
      }),
      makeAnnotation({
        name: 'Consumer',
        context: 'CtxB',
        consumes: ['event:two', 'event:three'],
      }),
      makeAnnotation({
        name: 'EventDef',
        context: 'CtxA',
        type: 'domain-event',
        layer: 'domain',
        event: 'event:four',
      }),
    ];
    const graph = buildGraph(annotations);
    expect(graph.events.size).toBe(4);
    expect(graph.events.has('event:one')).toBe(true);
    expect(graph.events.has('event:two')).toBe(true);
    expect(graph.events.has('event:three')).toBe(true);
    expect(graph.events.has('event:four')).toBe(true);
  });

  test('creates correct node keys as context::name', () => {
    const annotations: DomainAnnotation[] = [
      makeAnnotation({ name: 'ThreadRepo', context: 'Thread Management' }),
    ];
    const graph = buildGraph(annotations);
    expect(graph.nodes.has('Thread Management::ThreadRepo')).toBe(true);
    const node = graph.nodes.get('Thread Management::ThreadRepo');
    expect(node?.name).toBe('ThreadRepo');
  });

  test('handles empty annotations array', () => {
    const graph = buildGraph([]);
    expect(graph.nodes.size).toBe(0);
    expect(graph.contexts.size).toBe(0);
    expect(graph.events.size).toBe(0);
  });

  test('deduplicates event names that appear in both emits and consumes', () => {
    const annotations: DomainAnnotation[] = [
      makeAnnotation({
        name: 'Emitter',
        context: 'Ctx',
        emits: ['shared:event'],
      }),
      makeAnnotation({
        name: 'Listener',
        context: 'Ctx',
        consumes: ['shared:event'],
      }),
    ];
    const graph = buildGraph(annotations);
    // Set naturally deduplicates
    expect(graph.events.size).toBe(1);
    expect(graph.events.has('shared:event')).toBe(true);
  });
});
