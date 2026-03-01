import { describe, test, expect } from 'bun:test';

import { generateMermaid } from '../generators/mermaid.js';
import { buildGraph } from '../parser.js';
import type { DomainAnnotation } from '../types.js';

// ── Helpers ────────────────────────────────────────────────────────

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

// ── generateMermaid ────────────────────────────────────────────────

describe('generateMermaid', () => {
  test('generates a basic flowchart with default direction (LR)', () => {
    const graph = buildGraph([makeAnnotation({ name: 'MyService', context: 'Ctx' })]);
    const output = generateMermaid(graph);
    expect(output).toContain('flowchart LR');
  });

  test('respects direction option (TB)', () => {
    const graph = buildGraph([makeAnnotation({ name: 'MyService', context: 'Ctx' })]);
    const output = generateMermaid(graph, { direction: 'TB' });
    expect(output).toContain('flowchart TB');
    expect(output).not.toContain('flowchart LR');
  });

  test('creates subgraphs per bounded context', () => {
    const graph = buildGraph([
      makeAnnotation({ name: 'ServiceA', context: 'Auth' }),
      makeAnnotation({ name: 'ServiceB', context: 'Orders' }),
    ]);
    const output = generateMermaid(graph);
    expect(output).toContain('subgraph ctx_Auth["Auth"]');
    expect(output).toContain('subgraph ctx_Orders["Orders"]');
    // Both subgraphs should be closed
    const endCount = (output.match(/^\s*end$/gm) || []).length;
    expect(endCount).toBe(2);
  });

  test('renders event flow arrows between emitter and consumer', () => {
    const graph = buildGraph([
      makeAnnotation({
        name: 'OrderService',
        context: 'Orders',
        emits: ['order:placed'],
      }),
      makeAnnotation({
        name: 'NotificationHandler',
        context: 'Notifications',
        type: 'handler',
        consumes: ['order:placed'],
      }),
    ]);
    const output = generateMermaid(graph);
    // Should have an event flow arrow with the event name as label
    expect(output).toContain('%% Event flow');
    expect(output).toContain('-- "order:placed" -->');
  });

  test('renders dependency arrows (dashed)', () => {
    const graph = buildGraph([
      makeAnnotation({
        name: 'OrderService',
        context: 'Orders',
        depends: ['OrderRepository'],
      }),
      makeAnnotation({
        name: 'OrderRepository',
        context: 'Orders',
        type: 'repository',
        layer: 'infrastructure',
      }),
    ]);
    const output = generateMermaid(graph);
    expect(output).toContain('%% Dependencies');
    expect(output).toContain('-.->');
  });

  test('suppresses dependency arrows when eventsOnly is true', () => {
    const graph = buildGraph([
      makeAnnotation({
        name: 'OrderService',
        context: 'Orders',
        depends: ['OrderRepository'],
      }),
      makeAnnotation({
        name: 'OrderRepository',
        context: 'Orders',
        type: 'repository',
        layer: 'infrastructure',
      }),
    ]);
    const output = generateMermaid(graph, { eventsOnly: true });
    expect(output).not.toContain('%% Dependencies');
    expect(output).not.toContain('-.->');
  });

  test('context-level view collapses to one node per context with component count', () => {
    const graph = buildGraph([
      makeAnnotation({ name: 'ServiceA', context: 'Auth' }),
      makeAnnotation({ name: 'ServiceB', context: 'Auth' }),
      makeAnnotation({ name: 'ServiceC', context: 'Orders' }),
    ]);
    const output = generateMermaid(graph, { contextLevel: true });
    // Should show context nodes with component count, not subgraphs
    expect(output).toContain('Auth');
    expect(output).toContain('(2 components)');
    expect(output).toContain('Orders');
    expect(output).toContain('(1 components)');
    // Should NOT have subgraph syntax
    expect(output).not.toContain('subgraph');
  });

  test('includes layer class definitions (domain, application, infrastructure)', () => {
    const graph = buildGraph([makeAnnotation({ name: 'Svc', context: 'Ctx' })]);
    const output = generateMermaid(graph);
    expect(output).toContain('classDef domain');
    expect(output).toContain('classDef application');
    expect(output).toContain('classDef infrastructure');
  });

  test('context-level view renders inter-context event flow arrows', () => {
    const graph = buildGraph([
      makeAnnotation({
        name: 'OrderService',
        context: 'Orders',
        emits: ['order:placed'],
      }),
      makeAnnotation({
        name: 'NotificationHandler',
        context: 'Notifications',
        type: 'handler',
        consumes: ['order:placed'],
      }),
    ]);
    const output = generateMermaid(graph, { contextLevel: true });
    // Should have an arrow between the two contexts
    expect(output).toContain('Orders');
    expect(output).toContain('Notifications');
    expect(output).toContain('order:placed');
    expect(output).toContain('-->');
  });

  test('assigns layer class to each node in detailed view', () => {
    const graph = buildGraph([
      makeAnnotation({
        name: 'DomainSvc',
        context: 'Ctx',
        type: 'domain-service',
        layer: 'domain',
      }),
      makeAnnotation({
        name: 'AppSvc',
        context: 'Ctx',
        type: 'app-service',
        layer: 'application',
      }),
      makeAnnotation({
        name: 'InfraSvc',
        context: 'Ctx',
        type: 'adapter',
        layer: 'infrastructure',
      }),
    ]);
    const output = generateMermaid(graph);
    expect(output).toContain(':::domain');
    expect(output).toContain(':::application');
    expect(output).toContain(':::infrastructure');
  });
});
