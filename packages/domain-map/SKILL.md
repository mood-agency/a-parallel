---
name: domain-annotate
description: Analyzes a TypeScript source file and adds @domain JSDoc annotations describing its DDD role — subdomain, type, layer, events, and dependencies.
license: MIT
metadata:
  tags: ddd, domain-driven-design, annotation, architecture, subdomain, mermaid
  author: funny
  version: "3.0.0"
---

# Domain Annotate

Analyze a TypeScript source file and add `@domain` JSDoc annotations that describe its role in the Domain-Driven Design architecture. Works on **any** TypeScript/JavaScript codebase — subdomains and domain concepts are discovered dynamically from the code, not from a predefined list.

## When to Use

- User says `/domain-annotate` followed by a file path or refers to "the current file"
- User asks to "add domain annotations" or "annotate for DDD"
- User wants to classify a file's architectural role
- User wants to update existing `@domain` annotations after a refactor

## Annotation Format

Add a JSDoc block with `@domain` tags. Required tags: `subdomain`, `type`, `layer`. Optional: `subdomain-type`, `context`, `event`, `emits`, `consumes`, `aggregate`, `depends`.

```ts
/**
 * @domain subdomain: <Subdomain Name>
 * @domain subdomain-type: <core|supporting|generic>
 * @domain type: <DDD concept type>
 * @domain layer: <architectural layer>
 * @domain event: <event name>
 * @domain emits: <comma-separated events>
 * @domain consumes: <comma-separated events>
 * @domain aggregate: <aggregate root name>
 * @domain depends: <comma-separated dependencies>
 */
```

### Valid `type` values

#### Strategic (system-level boundaries)

| Type | Meaning | GoF Analogy |
|------|---------|-------------|
| `bounded-context` | Explicit boundary encapsulating a complete domain model | Facade |
| `anti-corruption-layer` | Translation layer between bounded contexts | Adapter + Facade |
| `published-language` | Shared format/contract for inter-context communication | Adapter |
| `context-map` | Orchestration of relationships between bounded contexts | Mediator |

#### Tactical (domain model building blocks)

| Type | Meaning | GoF Analogy |
|------|---------|-------------|
| `aggregate-root` | Entity that owns a consistency boundary | Facade + Composite |
| `entity` | Object with identity and lifecycle | Identity Map |
| `value-object` | Immutable object defined by its attributes | Flyweight |
| `domain-event` | Event payload interface/type | Observer |
| `domain-service` | Stateless domain logic that doesn't belong to an entity | Strategy |
| `app-service` | Application-layer orchestration (use cases) | Command + Facade |
| `repository` | Persistence abstraction (collection-like interface) | Facade + Proxy |
| `factory` | Encapsulates complex creation logic for aggregates/entities | Factory Method / Abstract Factory |
| `specification` | Combinable business rule evaluated against objects | Strategy + Composite + Interpreter |
| `policy` | Encapsulated business rule or decision logic | Strategy + Chain of Responsibility |
| `module` | Cohesive grouping of domain concepts (barrel/index file) | Package |

#### Architectural (infrastructure patterns)

| Type | Meaning | GoF Analogy |
|------|---------|-------------|
| `port` | Interface/contract (hexagonal architecture) | — |
| `adapter` | Implementation of a port | Adapter |
| `event-bus` | Event pub/sub infrastructure | Mediator + Observer |
| `handler` | Reactive event handler | Command |

### Valid `layer` values

- `domain` — Core business logic, types, events
- `application` — Use case orchestration, application services
- `infrastructure` — External concerns (DB, WebSocket, HTTP, filesystem)

### Valid `subdomain-type` values

- `core` — The product's differentiator; what makes this system unique and valuable
- `supporting` — Essential but not a differentiator; could theoretically be outsourced
- `generic` — Standard functionality found in most systems (auth, analytics, user profiles)

> **Note:** Some cross-cutting infrastructure (e.g., "Shared Kernel") may not have a subdomain-type classification — it's a DDD pattern name, not a strategic subdomain.

## Workflow

### Step 0: Discover the project's subdomains

Before annotating any file, understand the project's domain boundaries. **Do NOT use a predefined list of subdomains.** Instead, discover them dynamically:

1. **Read the project structure** — Use Glob to scan the top-level directory layout (`src/*/`, `packages/*/`, `modules/*/`, `lib/*/`)
2. **Look for existing `@domain` annotations** — Use Grep for `@domain subdomain:` across the codebase to find already-established subdomain names
3. **Infer subdomains from directory clusters** — Files grouped under a common directory that share imports and types likely form a subdomain. Name the subdomain using the **business capability** the cluster represents (e.g., "Billing", "User Management", "Notifications"), not the technical structure (avoid "Services", "Controllers", "Utils")
4. **Use PascalCase with spaces** for subdomain names — e.g., "Order Management", "Payment Processing", "Identity"

**Subdomain naming guidelines:**
- Name after the business capability, not technical layers: "Inventory" not "Database Layer"
- Keep names short (1-3 words): "Shipping" not "Shipping And Fulfillment Management System"
- Be consistent with existing annotations if any exist in the codebase
- When unsure, use the most prominent domain noun the module revolves around

**Subdomain classification guidelines:**
- `core` — Ask: "Is this what makes the product unique? Would a competitor need to replicate this?"
- `supporting` — Ask: "Is this essential for the product to work, but not our competitive advantage?"
- `generic` — Ask: "Could we buy this off-the-shelf or use a SaaS?" (auth, email, analytics)

### Step 1: Read the target file

Read the file the user specified. If no file is specified, use the currently open file from IDE context.

### Step 2: Analyze the file's DDD role

Determine the file's role by examining three dimensions:

**File path → layer hint:**
- `services/`, `domain/`, `core/`, `model/` → domain or application service
- `routes/`, `controllers/`, `api/`, `endpoints/` → infrastructure adapter (HTTP)
- `middleware/`, `interceptors/`, `guards/` → infrastructure adapter
- `db/`, `schema/`, `repositories/`, `persistence/`, `data/` → infrastructure (repository)
- `handlers/`, `listeners/`, `subscribers/` → handler (application layer)
- `lib/`, `utils/`, `helpers/`, `shared/` → domain or infrastructure utility
- `events/`, `messages/` → domain-event definitions
- `ports/`, `interfaces/`, `contracts/` → port definitions
- `adapters/`, `providers/`, `integrations/`, `external/` → adapter implementations
- `factories/` → factory
- `specs/`, `specifications/`, `rules/`, `policies/` → specification or policy

**Exports → type hint:**
- Class extending `EventEmitter`, `Subject`, or similar pub/sub base → `event-bus`
- Interface with method signatures used for dependency injection → `port`
- Class performing database CRUD (insert/update/delete/select, ORM calls) → `repository`
- Class/functions orchestrating multi-step workflows, coordinating other services → `app-service`
- Interface/type with event payload fields (no methods, data-only) → `domain-event`
- Pure business logic functions with no I/O side effects → `domain-service`
- HTTP route handlers (Express, Hono, Fastify, NestJS controllers, etc.) → `adapter` (infrastructure)
- Event handler objects/functions that react to domain events → `handler`
- Class/function that creates and returns Aggregates or Entities (static `.create()`, `build*()`, `new*()`, `from*()`) → `factory`
- Class/function with `.isSatisfiedBy()`, `.and()`, `.or()`, `.not()` or boolean predicate composition → `specification`
- Class/function encapsulating a business rule or decision (naming: `*Policy`, `*Rule`, `*Strategy`, `decide*`, `evaluate*`, `canDo*`) → `policy`
- Barrel/index file that re-exports related domain concepts cohesively → `module`
- Module that wraps an external API/system translating its types into internal domain types → `anti-corruption-layer`
- Shared schema/contract file (DTOs, API contracts, shared event interfaces between contexts) → `published-language`
- File that maps/routes between multiple bounded contexts or orchestrates cross-context communication → `context-map`
- File that represents a top-level boundary (facade over an entire subdomain, re-exports public API) → `bounded-context`

**Imports → subdomain hint:**

Instead of matching against a fixed list, infer the subdomain from import clusters:

1. **Identify the dominant import cluster** — What business domain do the majority of imports relate to?
2. **Look for domain nouns** — The imported types and classes reveal the business subdomain (e.g., imports of `Order`, `LineItem`, `CartService` → "Order Management")
3. **Cross-reference with existing annotations** — If imported modules already have `@domain subdomain:` tags, the importing file likely belongs to the same subdomain or depends on that subdomain
4. **When a file imports from multiple subdomains** — It's likely an `app-service`, `context-map`, or `anti-corruption-layer` sitting at a boundary

**Event patterns → emits/consumes:**

Look for any event emission or subscription pattern in the code:
- `.emit('event-name', ...)`, `.publish(...)`, `.dispatch(...)`, `.send(...)` → emits that event
- `.on('event-name', ...)`, `.subscribe(...)`, `.listen(...)`, `.handle(...)` → consumes that event
- Decorator-based: `@EventHandler('event-name')`, `@OnEvent('...')`, `@Subscribe('...')` → consumes
- Handler objects with `event: 'event-name'` or `type: 'event-name'` properties → consumes

### Step 3: Handle multi-export files

If the file exports multiple distinct DDD concepts:

1. **Group related items** — All event interfaces in a file can share one `@domain` block above the first one in the group
2. **Separate different concerns** — An EventBus class gets its own block (type: event-bus) while event interfaces get theirs (type: domain-event)
3. **Don't over-annotate** — If many event interfaces are identical in subdomain/type/layer, use ONE block above the first interface, not one per interface

### Step 4: Place the annotation

**Rules:**
1. If the file already has a file-level JSDoc at the top → add `@domain` tags to that existing block
2. If no file-level JSDoc exists → add a new `/** ... */` block BEFORE the first import statement
3. For multi-concept files → place each block directly above the relevant export or group
4. If the file already has `@domain` annotations → update the values in place
5. Preserve any non-`@domain` content in existing JSDoc blocks

### Step 5: Validate

After adding annotations, verify:
- Every `@domain` block has `subdomain`, `type`, and `layer` (required)
- `subdomain-type` is set if the subdomain has a clear strategic classification
- Event names follow a consistent format (e.g., `namespace:action` like `order:placed`, or `OrderPlaced` — match the project's existing convention)
- `depends` only lists significant domain dependencies, not utility imports like `path`, `lodash`, or `crypto`
- `aggregate` points to an actual aggregate root in the codebase
- Subdomain names are consistent with other annotations already in the project

## Examples

These examples use a generic e-commerce domain to illustrate each type. When annotating real code, use the actual subdomain names and class names from the target codebase.

### Entity
```ts
/**
 * @domain subdomain: Order Management
 * @domain subdomain-type: core
 * @domain type: entity
 * @domain layer: domain
 * @domain aggregate: Order
 */
export class LineItem {
  constructor(public readonly id: string, public productId: string, public quantity: number) {}
}
```

### Value Object
```ts
/**
 * @domain subdomain: Shipping
 * @domain subdomain-type: supporting
 * @domain type: value-object
 * @domain layer: domain
 */
export class Address {
  constructor(public readonly street: string, public readonly city: string, public readonly zip: string) {}
  equals(other: Address): boolean { return this.street === other.street && this.zip === other.zip; }
}
```

### Aggregate Root
```ts
/**
 * @domain subdomain: Order Management
 * @domain subdomain-type: core
 * @domain type: aggregate-root
 * @domain layer: domain
 * @domain emits: order:placed, order:cancelled
 */
export class Order {
  readonly id: string;
  private items: LineItem[] = [];
  place(): void { /* enforces invariants, emits order:placed */ }
}
```

### Domain Service
```ts
/**
 * @domain subdomain: Pricing
 * @domain subdomain-type: core
 * @domain type: domain-service
 * @domain layer: domain
 * @domain depends: TaxCalculator, DiscountPolicy
 */
export class PriceCalculator {
  calculate(items: LineItem[], customer: Customer): Money { ... }
}
```

### Application Service
```ts
/**
 * @domain subdomain: Order Management
 * @domain subdomain-type: core
 * @domain type: app-service
 * @domain layer: application
 * @domain emits: order:placed
 * @domain depends: OrderRepository, PriceCalculator, PaymentGateway
 */
export class PlaceOrderUseCase {
  execute(command: PlaceOrderCommand): Promise<Order> { ... }
}
```

### Repository
```ts
/**
 * @domain subdomain: Order Management
 * @domain subdomain-type: core
 * @domain type: repository
 * @domain layer: infrastructure
 * @domain aggregate: Order
 */
export class OrderRepository {
  findById(id: string): Promise<Order | null> { ... }
  save(order: Order): Promise<void> { ... }
}
```

### Factory
```ts
/**
 * @domain subdomain: Order Management
 * @domain subdomain-type: core
 * @domain type: factory
 * @domain layer: domain
 * @domain aggregate: Order
 * @domain depends: PriceCalculator
 */
export class OrderFactory {
  static create(cart: Cart, customer: Customer): Order { ... }
}
```

### Domain Event
```ts
/**
 * @domain subdomain: Order Management
 * @domain subdomain-type: core
 * @domain type: domain-event
 * @domain event: order:placed
 * @domain layer: domain
 * @domain aggregate: Order
 */
export interface OrderPlacedEvent {
  orderId: string;
  customerId: string;
  total: number;
  placedAt: Date;
}
```

### Event Bus
```ts
/**
 * @domain subdomain: Shared Kernel
 * @domain type: event-bus
 * @domain layer: infrastructure
 */
export class DomainEventBus extends EventEmitter {
  publish(event: DomainEvent): void { ... }
  subscribe(eventType: string, handler: EventHandler): void { ... }
}
```

### Handler
```ts
/**
 * @domain subdomain: Notifications
 * @domain subdomain-type: supporting
 * @domain type: handler
 * @domain layer: application
 * @domain consumes: order:placed
 * @domain depends: EmailService
 */
export class SendOrderConfirmationHandler {
  handle(event: OrderPlacedEvent): Promise<void> { ... }
}
```

### Specification
```ts
/**
 * @domain subdomain: Order Management
 * @domain subdomain-type: core
 * @domain type: specification
 * @domain layer: domain
 */
export class EligibleForFreeShipping {
  isSatisfiedBy(order: Order): boolean { return order.total > 100; }
  and(other: Specification<Order>): Specification<Order> { ... }
}
```

### Policy / Rule
```ts
/**
 * @domain subdomain: Pricing
 * @domain subdomain-type: core
 * @domain type: policy
 * @domain layer: domain
 */
export class DiscountPolicy {
  evaluate(customer: Customer, orderTotal: Money): Money { ... }
}
```

### Adapter (HTTP)
```ts
/**
 * @domain subdomain: Order Management
 * @domain subdomain-type: core
 * @domain type: adapter
 * @domain layer: infrastructure
 * @domain depends: PlaceOrderUseCase, OrderRepository
 */
export class OrderController {
  post(req: Request): Promise<Response> { ... }
  get(req: Request): Promise<Response> { ... }
}
```

### Port (DI interface)
```ts
/**
 * @domain subdomain: Payment Processing
 * @domain subdomain-type: supporting
 * @domain type: port
 * @domain layer: domain
 */
export interface PaymentGateway {
  charge(amount: Money, method: PaymentMethod): Promise<PaymentResult>;
  refund(transactionId: string): Promise<void>;
}
```

### Anti-Corruption Layer
```ts
/**
 * @domain subdomain: Payment Processing
 * @domain subdomain-type: supporting
 * @domain type: anti-corruption-layer
 * @domain layer: infrastructure
 * @domain depends: PaymentGateway
 */
export class StripePaymentAdapter implements PaymentGateway {
  /** Translates Stripe's API types into our domain PaymentResult */
  charge(amount: Money, method: PaymentMethod): Promise<PaymentResult> { ... }
}
```

### Published Language
```ts
/**
 * @domain subdomain: Shared Kernel
 * @domain type: published-language
 * @domain layer: domain
 */
export interface OrderDTO {
  id: string;
  status: 'pending' | 'confirmed' | 'shipped';
  items: Array<{ productId: string; quantity: number; price: number }>;
}
```

### Module
```ts
/**
 * @domain subdomain: Order Management
 * @domain subdomain-type: core
 * @domain type: module
 * @domain layer: domain
 */
export { Order } from './order.js';
export { LineItem } from './line-item.js';
export { OrderFactory } from './order-factory.js';
export { OrderPlacedEvent } from './events.js';
```

### Bounded Context (facade)
```ts
/**
 * @domain subdomain: Order Management
 * @domain subdomain-type: core
 * @domain type: bounded-context
 * @domain layer: domain
 * @domain depends: Payment Processing, Shipping
 */
export class OrderManagementFacade {
  placeOrder(cmd: PlaceOrderCommand): Promise<Order> { ... }
  cancelOrder(orderId: string): Promise<void> { ... }
}
```

### Context Map
```ts
/**
 * @domain subdomain: Shared Kernel
 * @domain type: context-map
 * @domain layer: application
 * @domain depends: Order Management, Payment Processing, Shipping
 */
export class CheckoutOrchestrator {
  /** Coordinates across subdomains to complete checkout */
  checkout(cart: Cart, payment: PaymentMethod, address: Address): Promise<Order> { ... }
}
```

## Verification

After annotating, if the project has a domain-map CLI tool, suggest running it to verify:

```bash
# Scan source directory and generate Mermaid diagram
bun <path-to-domain-map-cli> <source-directory>

# Generate event catalog to check event flows
bun <path-to-domain-map-cli> --format catalog <source-directory>

# Generate sequence diagrams for a specific event family
bun <path-to-domain-map-cli> --format sequence --scenario agent <source-directory>
```

Otherwise, use Grep to verify annotation consistency:

```bash
# List all discovered subdomains
grep -r "@domain subdomain:" src/ | sed 's/.*subdomain: //' | sort -u

# Find annotations missing required tags
grep -r "@domain" src/ | grep -v "subdomain:\|type:\|layer:"
```
