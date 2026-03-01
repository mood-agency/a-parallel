// ── DDD Concept Types ────────────────────────────────────────────

export type DomainType =
  // ── DDD Strategic ───────────────────────────────────
  | 'bounded-context'
  | 'anti-corruption-layer'
  | 'published-language'
  | 'context-map'
  // ── DDD Tactical ────────────────────────────────────
  | 'aggregate-root'
  | 'entity'
  | 'value-object'
  | 'domain-event'
  | 'domain-service'
  | 'app-service'
  | 'repository'
  | 'factory'
  | 'specification'
  | 'policy'
  | 'module'
  // ── Architectural ───────────────────────────────────
  | 'port'
  | 'adapter'
  | 'event-bus'
  | 'handler';

export type DomainLayer = 'domain' | 'application' | 'infrastructure';

// ── Single annotation block ──────────────────────────────────────

export interface DomainAnnotation {
  /** Absolute or relative file path */
  filePath: string;

  /** Name of the annotated export (class, interface, const, etc.).
   *  Falls back to filename stem for file-level annotations. */
  name: string;

  /** Bounded Context name (e.g., "Git Operations") */
  context: string;

  /** DDD concept type */
  type: DomainType;

  /** Architectural layer */
  layer: DomainLayer;

  /** For domain-event types: the event this interface defines */
  event?: string;

  /** Events this component emits */
  emits: string[];

  /** Events this component consumes */
  consumes: string[];

  /** Parent aggregate root name */
  aggregate?: string;

  /** Dependencies (other domain components) */
  depends: string[];
}

// ── Graph built from all annotations ─────────────────────────────

export interface DomainGraph {
  /** All parsed annotations, keyed by `${context}::${name}` */
  nodes: Map<string, DomainAnnotation>;

  /** Bounded Contexts discovered, with their member node keys */
  contexts: Map<string, string[]>;

  /** All unique event names found across emits/consumes/event tags */
  events: Set<string>;
}

// ── CLI options ──────────────────────────────────────────────────

export interface CLIOptions {
  /** Source directory to scan (default: cwd) */
  dir: string;

  /** Output file path (default: stdout) */
  output?: string;

  /** Filter: only show nodes in these bounded contexts */
  filterContext?: string[];

  /** Filter: only show nodes of these types */
  filterType?: DomainType[];

  /** Output format */
  format: 'mermaid' | 'json';

  /** Show event flow only (suppress dependency arrows) */
  eventsOnly: boolean;

  /** Mermaid diagram direction */
  direction: 'LR' | 'TB';
}
