# Tech Stack: Pipeline Service

Este documento define las librerias, frameworks, y herramientas especificas para implementar el Pipeline Service descrito en [SAD.md](SAD.md).

---

## 1. Runtime y Lenguaje

| Componente | Eleccion | Version |
|---|---|---|
| **Runtime** | Bun | >= 1.2 |
| **Lenguaje** | TypeScript | (built-in de Bun) |
| **Package Manager** | bun (built-in) | — |
| **Module System** | ESM | — |

**Por que Bun:**
- Ejecuta TypeScript nativamente — sin `tsc`, sin `tsx`, sin paso de compilacion para desarrollo
- Package manager integrado — `bun install` es ~25x mas rapido que `npm install`
- `Bun.file()` y `Bun.write()` — API de filesystem optimizada, mas rapida que `node:fs/promises`
- `Bun.spawn()` — Para lanzar procesos (git, Claude Code CLI como fallback)
- `fetch` global nativo
- Lee `.env` automaticamente — sin `dotenv`
- Test runner integrado (`bun test`) — sin Vitest ni Jest
- Compatible con el ecosistema npm — todas las librerias de Node.js funcionan

**Por que TypeScript:**
- Todo el sistema depende de contratos tipados (`PipelineRequest`, `PipelineEvent`)
- Los adapters implementan interfaces — TypeScript lo hace verificable en compile time
- Los patrones de diseno (Strategy, Command, State Machine) se expresan naturalmente con tipos

**Lo que Bun elimina del stack:**
| Herramienta | Reemplazado por |
|---|---|
| `tsx` | Bun ejecuta `.ts` directamente |
| `dotenv` | Bun lee `.env` automaticamente |
| `@types/node` | Bun incluye sus propios tipos |
| `vitest` / `jest` | `bun test` |
| `node:fs/promises` | `Bun.file()` / `Bun.write()` (aunque `node:fs` tambien funciona) |

---

## 2. HTTP Server

| Componente | Libreria | Version |
|---|---|---|
| **Framework** | Hono | ^4 |
| **Validacion** | `@hono/zod-validator` | ^0.4 |

Hono incluye todo lo que necesitamos como middleware built-in — no hay plugins externos:

| Funcionalidad | Hono | Donde |
|---|---|---|
| CORS | `hono/cors` | Built-in |
| Bearer Auth | `hono/bearer-auth` | Built-in |
| SSE | `hono/streaming` | Built-in |
| Logger | `hono/logger` | Built-in |
| ETag | `hono/etag` | Built-in |

**Por que Hono:**

| | Express | Fastify | Hono |
|---|---|---|---|
| Tamano | ~200kb | ~100kb | ~14kb |
| TypeScript | Manual | Bueno | Nativo (escrito en TS) |
| Validacion | Externo | JSON Schema (Ajv) | Zod via `@hono/zod-validator` |
| SSE | Manual | Plugin | Built-in (`streamSSE`) |
| CORS | Externo | Plugin | Built-in |
| Auth | Externo | Plugin | Built-in |
| Bun support | Funciona | Funciona | Optimizado para Bun |
| API | Callbacks | Async/await | Method chaining, tipado end-to-end |
| Runtimes | Node.js | Node.js | Bun, Node, Deno, Workers, Lambda |

Hono esta disenado para runtimes modernos. Con Bun, no necesita adaptador — corre directo. Ademas, con `@hono/zod-validator`, la validacion usa Zod en vez de JSON Schema, lo que significa **un solo sistema de validacion** (Zod) para HTTP y logica de negocio.

### Configuracion del server

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bearerAuth } from 'hono/bearer-auth'
import { logger } from 'hono/logger'

const app = new Hono()

app.use('*', cors())
app.use('*', logger())
app.use('*', bearerAuth({ token: process.env.API_TOKEN! }))
```

### Validacion con Zod (unico sistema de validacion)

```typescript
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const PipelineRunSchema = z.object({
  branch:        z.string().min(1),
  worktree_path: z.string().min(1),
  base_branch:   z.string().default('main'),
  priority:      z.number().int().min(1).max(10).optional(),
  depends_on:    z.array(z.string()).optional(),
  config: z.object({
    tier_override:            z.enum(['small', 'medium', 'large']).nullable().optional(),
    auto_correct:             z.boolean().default(true),
    max_correction_attempts:  z.number().int().default(3),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
})

app.post('/pipeline/run',
  zValidator('json', PipelineRunSchema),
  async (c) => {
    const body = c.req.valid('json')  // ← tipado automatico desde el schema Zod
    const requestId = crypto.randomUUID()

    // ... crear PipelineRequest y lanzar pipeline

    return c.json({
      request_id: requestId,
      status: 'accepted',
      pipeline_branch: `pipeline/${body.branch}`,
      events_url: `/pipeline/${requestId}/events`,
    }, 202)
  }
)
```

Hono + Zod validan el body y lo tipan automaticamente. Si el body no cumple el schema, responde `400` sin tocar el handler. **Un solo schema** valida estructura y negocio — no hay Ajv + Zod como en Fastify.

### SSE para streaming de eventos

```typescript
import { streamSSE } from 'hono/streaming'

app.get('/pipeline/:requestId/events', (c) => {
  const requestId = c.req.param('requestId')

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'connected', data: JSON.stringify({ request_id: requestId }) })

    const handler = async (event: PipelineEvent) => {
      await stream.writeSSE({ event: event.event_type, data: JSON.stringify(event) })
    }

    eventBus.on(`pipeline.${requestId}`, handler)

    stream.onAbort(() => {
      eventBus.off(`pipeline.${requestId}`, handler)
    })

    // Mantener el stream abierto
    while (true) {
      await stream.sleep(30_000)
      await stream.writeSSE({ event: 'ping', data: '' })
    }
  })
})
```

### Levantar el server con Bun

```typescript
// src/server.ts
import { Hono } from 'hono'

const app = new Hono()
// ... routes ...

export default {
  port: config.adapters.inbound.rest_api.port,
  fetch: app.fetch,
}
```

Bun detecta el `export default` con `fetch` y levanta el server automaticamente. Sin `app.listen()`, sin callbacks, sin boilerplate.

Para desarrollo: `bun --watch src/server.ts`
Para produccion: `bun src/server.ts`

---

## 3. Integracion con Claude Code

| Componente | Libreria | Version |
|---|---|---|
| **SDK** | `@anthropic-ai/claude-code` | latest |

### Claude Agent SDK vs CLI subprocess

El documento de arquitectura define que el Service "spawna Claude Code como subprocess" (`claude -p "..."`). Hay dos formas de hacerlo:

| | CLI subprocess (`Bun.spawn`) | Claude Agent SDK |
|---|---|---|
| Invocacion | `Bun.spawn(['claude', '-p', prompt])` | `claude(prompt, { options })` |
| Tipos | Sin tipado | TypeScript nativo |
| Streaming | Parsear stdout manualmente | Eventos tipados (`AssistantMessage`, `ToolUse`) |
| Sesion | Nueva sesion cada vez | Se puede reanudar con `sessionId` |
| Herramientas | Lo que tenga instalado el CLI | Se pueden pasar `allowedTools` |
| Errores | Exit codes y stderr | Excepciones tipadas |
| Subagentes | El CLI los maneja internamente | Visibilidad en los eventos |

**Eleccion: Claude Agent SDK (`@anthropic-ai/claude-code`).**

El SDK da control programatico completo. El Service puede:
- Lanzar agentes con prompts especificos
- Recibir eventos en streaming (saber cuando un agente usa una herramienta)
- Limitar herramientas permitidas por agente
- Manejar errores con tipos
- Reutilizar sesiones

### Como se ejecuta el Pipeline Core

El Pipeline Core es un proceso de Claude Code. El Service lo lanza con el SDK:

```typescript
import { claude, type MessageEvent } from '@anthropic-ai/claude-code'

async function runPipeline(request: PipelineRequest): Promise<void> {
  const prompt = buildPipelinePrompt(request)

  const events = claude(prompt, {
    cwd: request.worktree_path,
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Task'],
    model: 'sonnet',  // Sonnet para los agentes (balance costo/calidad)
    maxTurns: 50,
    // Las skills del pipeline estan en el CLAUDE.md del worktree
  })

  for await (const event of events) {
    // Cada evento del SDK se traduce a PipelineEvent y se emite al Event Bus
    if (event.type === 'assistant' && event.message) {
      eventBus.emit('pipeline.progress', {
        request_id: request.request_id,
        message: event.message
      })
    }

    if (event.type === 'result') {
      // Parsear resultado final del agente
      const result = parsePipelineResult(event.result)
      eventBus.emit('pipeline.completed', {
        request_id: request.request_id,
        ...result
      })
    }
  }
}
```

### Como se ejecutan los 8 agentes en paralelo

Claude Code soporta ejecucion de agentes en paralelo nativamente via el **Task tool**. El Service lanza **un solo proceso de Claude Code** (el Pipeline Core), y este proceso usa `Task` para lanzar los 8 agentes como subagentes concurrentes.

```
Service (Bun)
    │
    │  claude(prompt, { allowedTools: ['Task', ...] })
    │
    ▼
Pipeline Core (1 proceso Claude Code)
    │
    │  Usa el Task tool para lanzar 8 subagentes en paralelo
    │
    ├── Task(security-audit)         ──┐
    ├── Task(architecture-eval)      ──┤
    ├── Task(webapp-testing)         ──┤
    ├── Task(performance)            ──┼── PARALELO (Claude Code los ejecuta concurrentemente)
    ├── Task(dependency-audit)       ──┤
    ├── Task(code-quality)           ──┤
    ├── Task(web-design-guidelines)  ──┤
    └── Task(documentation-check)   ──┘
                                       │
                                       ▼
                              Core consolida resultados
```

**Por que un solo proceso y no 8 instancias del SDK:**

| | 8 instancias del SDK | 1 proceso + Task tool |
|---|---|---|
| Procesos | 8 procesos Claude Code separados | 1 proceso, N subagentes internos |
| Coordinacion | Manual (`Promise.allSettled`) en el Service | Claude Code coordina internamente |
| Consolidacion | El Service parsea 8 resultados | El Core consolida y decide |
| Auto-correccion | El Service debe relanzar agentes | El Core reintenta internamente |
| Contexto compartido | Cada agente arranca sin contexto | Los subagentes heredan contexto del Core |
| Skills | Hay que pasar skills a cada instancia | Las skills estan en el worktree (`CLAUDE.md`) |

El Pipeline Core es un agente de Claude Code que **sabe como correr el pipeline**. Su prompt le dice: "analiza este worktree, clasifica el tier, lanza los agentes necesarios via Task, consolida resultados, auto-corrige si es necesario". El SDK del Service solo lanza este proceso y escucha los eventos.

### Prompt del Pipeline Core

El prompt que el Service le pasa al Pipeline Core incluye toda la informacion del `PipelineRequest`:

```typescript
function buildPipelinePrompt(request: PipelineRequest): string {
  return `
Eres el Pipeline Core. Tu trabajo es ejecutar el pipeline de calidad sobre este worktree.

## Request
- Branch: ${request.branch}
- Pipeline branch: pipeline/${request.branch}
- Base branch: ${request.base_branch}
- Tier override: ${request.config.tier_override ?? 'auto'}
- Auto-correct: ${request.config.auto_correct}
- Max correction attempts: ${request.config.max_correction_attempts}

## Instrucciones
1. Crea la rama pipeline/${request.branch} desde ${request.branch}
2. Analiza el cambio (git diff --stat) y clasifica el tier (Small/Medium/Large)
3. Lanza los agentes del tier usando el Task tool — TODOS EN PARALELO
4. Si hay agentes bloqueantes que fallan, auto-corrige en la rama pipeline/
5. Re-ejecuta solo los agentes que fallaron (max ${request.config.max_correction_attempts} intentos)
6. Cuando todo pase, haz merge back de pipeline/ a la rama original
7. Reporta el resultado final en formato JSON

## Agentes disponibles (via Task tool)
- security-audit: Analisis de seguridad (BLOQUEANTE)
- webapp-testing: Tests (BLOQUEANTE)
- architecture-eval: Evaluacion arquitectonica (BLOQUEANTE, tier medium+)
- dependency-audit: Auditoria de dependencias (BLOQUEANTE, tier medium+)
- code-quality: Code quality (tier medium+)
- performance: Performance (tier large)
- web-design-guidelines: Accesibilidad (tier large, solo si hay cambios UI)
- documentation-check: Documentacion (tier large)

Lanza multiples Tasks en paralelo en un solo mensaje.
  `.trim()
}
```

### Lo que el Service ve via el SDK

El Service no ve los subagentes directamente. Ve los eventos de alto nivel del proceso de Claude Code:

```typescript
async function runPipeline(request: PipelineRequest): Promise<void> {
  const prompt = buildPipelinePrompt(request)

  const events = claude(prompt, {
    cwd: request.worktree_path,
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Task'],
    model: 'sonnet',
    maxTurns: 50,
  })

  for await (const event of events) {
    // El SDK emite eventos cuando el Core usa herramientas
    if (event.type === 'tool_use' && event.tool === 'Task') {
      // Un subagente fue lanzado
      eventBus.publish({
        event_type: 'pipeline.agent.started',
        request_id: request.request_id,
        data: { agent: event.input.description }
      })
    }

    if (event.type === 'result') {
      const result = parsePipelineResult(event.result)
      eventBus.publish({
        event_type: result.approved ? 'pipeline.completed' : 'pipeline.failed',
        request_id: request.request_id,
        data: result
      })
    }
  }
}
```

### Como se ejecutan el Director y el Integrador

El Director y el Integrador tambien son procesos de Claude Code, pero con prompts diferentes y herramientas diferentes:

```typescript
// Director — lee manifest, decide que integrar
async function runDirector(): Promise<void> {
  const result = await claude(DIRECTOR_PROMPT, {
    cwd: projectRoot,
    allowedTools: ['Read', 'Bash', 'Write'],
    model: 'sonnet',
    maxTurns: 30,
  })

  // Parsear decisiones del Director y ejecutar
}

// Integrador — crea PRs, resuelve conflictos
async function runIntegrator(branch: string): Promise<void> {
  const result = await claude(buildIntegratorPrompt(branch), {
    cwd: projectRoot,
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
    model: 'opus',  // Opus para resoluciones complejas (conflictos, deduplicacion)
    maxTurns: 40,
  })
}
```

### Modelo por componente

| Componente | Modelo | Razon |
|---|---|---|
| **Agentes de calidad** (8) | Sonnet | Balance costo/velocidad. Tareas bien definidas con skills. |
| **Auto-correccion** | Sonnet | Aplica fixes especificos basados en hallazgos claros. |
| **Director** | Sonnet | Logica de decision sobre manifest + deps. No requiere razonamiento profundo. |
| **Integrador** | Opus | Resolucion de conflictos, deduplicacion, analisis semantico. Requiere razonamiento complejo. |

### Costos de ejecucion

Cada pipeline ejecuta multiples llamadas a Claude. Los agentes corren en paralelo, lo que reduce tiempo pero no tokens.

| Tier | Agentes | Llamadas Claude (approx) | Modelo |
|---|---|---|---|
| Small | 2 | 2 agentes + 0-3 correcciones | Sonnet |
| Medium | 5 | 5 agentes + 0-3 correcciones | Sonnet |
| Large | 8 | 8 agentes + 0-3 correcciones | Sonnet |
| Integrador | 1 | 1 por rama | Opus |

---

## 4. Git Operations

| Componente | Libreria | Uso |
|---|---|---|
| **Git programatico** | `simple-git` | ^3 |
| **GitHub API** | `@octokit/rest` | ^21 |

### Por que `simple-git` y no `Bun.spawn` + `git`

| | `Bun.spawn` + git raw | `simple-git` |
|---|---|---|
| Interfaz | Strings (parsear stdout) | Metodos tipados |
| Errores | Exit codes | Excepciones con contexto |
| Branch | `Bun.spawn(['git', 'checkout', '-b', name])` | `git.checkoutBranch(name, start)` |
| Diff | Parsear `git diff --stat` manualmente | `git.diffSummary()` → objeto tipado |
| Log | Parsear `git log --format=...` | `git.log({ maxCount: 10 })` → array |
| Merge | `Bun.spawn(['git', 'merge', '--no-ff', branch])` | `git.merge([branch, '--no-ff'])` |

`simple-git` envuelve el binario `git` del sistema (no es una reimplementacion). Usa el `git` instalado, pero da una interfaz TypeScript sobre los resultados.

### Uso en el Pipeline

```typescript
import simpleGit from 'simple-git'

const git = simpleGit(worktreePath)

// Clasificacion de tier
const diff = await git.diffSummary(['main...HEAD'])
const tier = classifyTier(diff.files.length, diff.insertions + diff.deletions)

// Crear rama de pipeline
await git.checkoutBranch(`pipeline/${branch}`, branch)

// Merge back despues de pipeline
await git.checkout(branch)
await git.merge([`pipeline/${branch}`, '--no-ff'])

// Para el Integrador
await git.checkoutBranch(`integration/${branch}`, 'main')
await git.merge([`pipeline/${branch}`, '--no-ff'])
```

### GitHub API con @octokit/rest

```typescript
import { Octokit } from '@octokit/rest'

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

// Crear PR (Integrador)
const { data: pr } = await octokit.pulls.create({
  owner, repo,
  title: `Integrate: ${branch}`,
  head: `integration/${branch}`,
  base: 'main',
  body: generatePRBody(pipelineResults)
})

// Comentar en PR
await octokit.issues.createComment({
  owner, repo,
  issue_number: pr.number,
  body: '✅ Pipeline passed. Ready for review.'
})

// Agregar labels
await octokit.issues.addLabels({
  owner, repo,
  issue_number: pr.number,
  labels: ['pipeline-approved']
})
```

### Cuando usar `@octokit` vs `simple-git`

| Operacion | Herramienta | Razon |
|---|---|---|
| Crear PR | `@octokit/rest` | Respuesta tipada, control total del body |
| Comentar PR | `@octokit/rest` | Programatico, sin parsear stdout |
| Verificar PR status | `@octokit/rest` | JSON tipado |
| Force push con lease | `simple-git` | `git push --force-with-lease` (no es API de GitHub) |
| Recibir webhooks | Hono (el server) | El Service expone endpoint, GitHub hace POST |

**Regla:** Usar `@octokit/rest` para todo lo que sea GitHub API. Usar `simple-git` para operaciones git locales.

---

## 5. Event Bus

| Componente | Libreria | Uso |
|---|---|---|
| **Local** | `eventemitter3` | Event Bus en memoria |
| **Persistencia** | `Bun.write()` / `Bun.file()` | Escribir/leer JSONL |
| **Escalable (opcional)** | `ioredis` | Redis Pub/Sub |
| **Escalable (opcional)** | `nats` | NATS messaging |

### Por que `eventemitter3` y no `node:events`

| | `node:events` | `eventemitter3` |
|---|---|---|
| Performance | Buena | ~3x mas rapida |
| TypeScript | Generics basicos | Generics completos |
| Memory leaks | Warning a 10 listeners | Sin limite artificial |
| Bun compat | Si | Si |

`eventemitter3` es un drop-in replacement de `EventEmitter` con mejor performance y tipado. El API es identico.

### Implementacion del Event Bus

```typescript
import EventEmitter from 'eventemitter3'

interface EventBusEvents {
  'pipeline.started':             (event: PipelineEvent) => void
  'pipeline.agent.completed':     (event: PipelineEvent) => void
  'pipeline.round.completed':     (event: PipelineEvent) => void
  'pipeline.correction.started':  (event: PipelineEvent) => void
  'pipeline.correction.completed':(event: PipelineEvent) => void
  'pipeline.completed':           (event: PipelineEvent) => void
  'pipeline.failed':              (event: PipelineEvent) => void
  'pipeline.error':               (event: PipelineEvent) => void
  'director.activated':           (event: PipelineEvent) => void
  'integration.pr.created':       (event: PipelineEvent) => void
  'integration.pr.merged':        (event: PipelineEvent) => void
  // ... todos los eventos del catalogo
}

class PipelineEventBus extends EventEmitter<EventBusEvents> {
  private persistPath: string

  constructor(persistPath: string) {
    super()
    this.persistPath = persistPath
  }

  async publish(event: PipelineEvent): Promise<void> {
    // 1. Persistir en JSONL (Bun.write con append)
    const file = Bun.file(`${this.persistPath}/${event.request_id}.jsonl`)
    const existing = await file.exists() ? await file.text() : ''
    await Bun.write(file, existing + JSON.stringify(event) + '\n')

    // 2. Emitir a todos los suscriptores en memoria
    this.emit(event.event_type as keyof EventBusEvents, event)
  }
}
```

### Escalado a Redis (cuando se necesite)

Si el Service necesita correr en multiples instancias, el Event Bus se puede cambiar a Redis sin modificar los adapters:

```typescript
import Redis from 'ioredis'

class RedisEventBus extends EventEmitter<EventBusEvents> {
  private pub: Redis
  private sub: Redis

  constructor(redisUrl: string) {
    super()
    this.pub = new Redis(redisUrl)
    this.sub = new Redis(redisUrl)

    this.sub.on('message', (channel, message) => {
      const event = JSON.parse(message) as PipelineEvent
      this.emit(event.event_type as keyof EventBusEvents, event)
    })
  }

  async publish(event: PipelineEvent): Promise<void> {
    await this.pub.publish('pipeline-events', JSON.stringify(event))
  }
}
```

El cambio es un adapter — los componentes que usan `eventBus.on()` y `eventBus.publish()` no cambian.

---

## 6. Logging

| Componente | Libreria | Version |
|---|---|---|
| **Logger** | Pino | ^9 |
| **Pretty print (dev)** | `pino-pretty` | ^13 |

### Por que Pino

| | Winston | Pino | Bunyan |
|---|---|---|---|
| Performance | ~5k logs/s | ~100k logs/s | ~10k logs/s |
| Formato nativo | String → JSON (transform) | JSON nativo | JSON nativo |
| Overhead en prod | Alto (formatters) | Minimo (solo JSON.stringify) | Medio |
| Child loggers | Si | Si, con campos heredados | Si |

Pino produce JSON por defecto — exactamente el formato que definimos en la arquitectura. No hay transformacion. Cada log entry es una linea JSON.

### Integracion con el sistema de logging

El formato de log definido en la arquitectura es:

```json
{
  "timestamp": "2026-02-14T12:00:01.234Z",
  "level": "info",
  "source": "core.agent.security",
  "request_id": "abc-123",
  "action": "scan.file",
  "message": "Scanning auth.ts for vulnerabilities",
  "data": { "file": "src/auth.ts" },
  "duration_ms": 3200
}
```

Pino soporta esto nativamente con child loggers:

```typescript
import pino from 'pino'

// Logger base del sistema
const systemLogger = pino({
  level: config.logging.level,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: undefined,  // No incluir hostname/pid
  formatters: {
    level(label) { return { level: label } }
  }
})

// Child logger para un pipeline especifico
function createPipelineLogger(requestId: string): pino.Logger {
  return systemLogger.child({ request_id: requestId })
}

// Child logger para un componente especifico
function createSourceLogger(source: string, requestId?: string): pino.Logger {
  return systemLogger.child({
    source,
    ...(requestId ? { request_id: requestId } : {})
  })
}

// Uso
const log = createSourceLogger('core.agent.security', 'abc-123')
log.info({ action: 'scan.file', data: { file: 'src/auth.ts' }, duration_ms: 3200 }, 'Scanning auth.ts')
// Produce: {"timestamp":"2026-...","level":"info","source":"core.agent.security","request_id":"abc-123","action":"scan.file","message":"Scanning auth.ts","data":{"file":"src/auth.ts"},"duration_ms":3200}
```

### Escritura a archivos por request_id

Pino escribe a stdout por defecto. Para separar logs por `request_id` + sistema, usamos un transport custom:

```typescript
// Transport custom que separa por request_id
const transport = pino.transport({
  target: './log-splitter.ts',
  options: {
    basePath: config.logging.path
  }
})

const logger = pino(transport)
```

```typescript
// log-splitter.ts — Pino transport custom
import { mkdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import build from 'pino-abstract-transport'

export default async function(opts: { basePath: string }) {
  const streams = new Map<string, ReturnType<typeof createWriteStream>>()

  return build(async function(source) {
    for await (const obj of source) {
      const date = new Date().toISOString().split('T')[0]
      const dir = `${opts.basePath}/${date}`
      await mkdir(dir, { recursive: true })

      const file = obj.request_id
        ? `${dir}/${obj.request_id}.jsonl`
        : `${dir}/system.jsonl`

      if (!streams.has(file)) {
        streams.set(file, createWriteStream(file, { flags: 'a' }))
      }

      streams.get(file)!.write(JSON.stringify(obj) + '\n')
    }
  })
}
```

### Middleware de Hono para HTTP logging

Hono tiene un `logger()` middleware que loggea requests HTTP. Para integrarlo con Pino:

```typescript
import { logger as honoLogger } from 'hono/logger'

// Opcion 1: usar el logger built-in de Hono (simple, a stdout)
app.use('*', honoLogger())

// Opcion 2: custom middleware que usa Pino
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start

  pinoLogger.info({
    source: 'inbound.rest',
    action: 'request.completed',
    data: {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
    },
    duration_ms: duration
  }, `${c.req.method} ${c.req.path} → ${c.res.status}`)
})
```

---

## 7. Patrones de Diseno: Librerias por Patron

### 7.1 Adapter — Sin libreria

Los adapters son codigo propio. Son clases TypeScript que implementan una interfaz. No necesitan libreria.

```typescript
// Puerto (interfaz)
interface InboundPort {
  toPipelineRequest(raw: unknown): PipelineRequest
}

// Adapter concreto
class RestAdapter implements InboundPort {
  toPipelineRequest(raw: unknown): PipelineRequest {
    return {
      request_id: crypto.randomUUID(),
      branch: (raw as any).branch,
      worktree_path: (raw as any).worktree_path,
      // ...
    }
  }
}
```

No hay libreria porque el patron es una estructura de codigo, no una herramienta.

### 7.2 Observer / Pub-Sub — `eventemitter3`

Ya cubierto en la seccion 5 (Event Bus). `eventemitter3` es toda la libreria que necesitamos.

### 7.3 Command — Sin libreria

`PipelineRequest` es el comando. Es un objeto JSON plano que se serializa, persiste, y encola. No necesita libreria.

```typescript
interface PipelineRequest {
  request_id: string
  branch: string
  worktree_path: string
  base_branch: string
  config: PipelineConfig
  metadata: Record<string, unknown>
}
```

### 7.4 Strategy — Sin libreria

El patron Strategy se implementa con un map de funciones:

```typescript
type TierStrategy = {
  name: 'small' | 'medium' | 'large'
  agents: AgentName[]
}

const TIER_STRATEGIES: Record<string, TierStrategy> = {
  small:  { name: 'small',  agents: ['tests', 'security'] },
  medium: { name: 'medium', agents: ['tests', 'security', 'architecture', 'dependencies', 'code_quality'] },
  large:  { name: 'large',  agents: ['tests', 'security', 'architecture', 'dependencies', 'code_quality', 'performance', 'accessibility', 'documentation'] },
}

function selectTier(diff: DiffSummary, override?: string): TierStrategy {
  if (override) return TIER_STRATEGIES[override]
  if (diff.files.length > 10 || diff.lines > 300) return TIER_STRATEGIES.large
  if (diff.files.length > 3 || diff.lines > 50) return TIER_STRATEGIES.medium
  return TIER_STRATEGIES.small
}
```

No necesita libreria. Es logica pura.

### 7.5 State Machine — `xstate`

| Componente | Libreria | Version |
|---|---|---|
| **State Machine** | `xstate` | ^5 |

**Por que `xstate`:**
- Es el estandar de la industria para state machines en JavaScript/TypeScript
- Previene transiciones invalidas por definicion
- Visualizable (hay herramientas para generar diagramas del statechart)
- Persiste el estado actual (para recovery despues de crash)
- TypeScript-first desde v5

**Maquina de estados del manifiesto:**

```typescript
import { createMachine, createActor } from 'xstate'

const branchMachine = createMachine({
  id: 'branch',
  initial: 'running',
  states: {
    running: {
      on: {
        'PIPELINE_APPROVED': 'ready',
        'PIPELINE_FAILED':   'failed'
      }
    },
    ready: {
      on: {
        'PR_CREATED': 'pending_merge'
      }
    },
    pending_merge: {
      on: {
        'PR_MERGED':   'merge_history',
        'PR_CLOSED':   'ready',        // Reintentar
        'PR_STALE':    'pending_merge'  // Rebase y seguir en pending
      }
    },
    merge_history: {
      type: 'final'
    },
    failed: {
      // Terminal — requiere intervencion
    }
  }
})

// Uso
const actor = createActor(branchMachine).start()
actor.send({ type: 'PIPELINE_APPROVED' })
console.log(actor.getSnapshot().value) // 'ready'

// Transicion invalida → no hace nada (safe by design)
actor.send({ type: 'PR_MERGED' }) // Ignorado — no hay transicion ready → merge_history
```

**Persistencia del estado:**

`xstate` puede serializar el estado con `actor.getPersistedSnapshot()` y restaurarlo con `createActor(machine, { snapshot })`. Esto permite recovery despues de un crash del Service.

### 7.6 Saga — Implementacion propia

No hay una libreria de Sagas para Node.js/Bun que encaje en nuestro flujo. Las librerias existentes estan orientadas a microservicios con message brokers. Nuestro caso es mas simple: un proceso secuencial con compensacion.

```typescript
interface SagaStep {
  name: string
  execute: () => Promise<void>
  compensate: () => Promise<void>
}

class Saga {
  private steps: SagaStep[] = []
  private completedSteps: string[] = []
  private persistPath: string

  constructor(requestId: string, persistPath: string) {
    this.persistPath = `${persistPath}/${requestId}.json`
  }

  addStep(step: SagaStep): void {
    this.steps.push(step)
  }

  async execute(): Promise<void> {
    for (const step of this.steps) {
      try {
        await step.execute()
        this.completedSteps.push(step.name)
        await this.persist()
      } catch (error) {
        await this.compensate()
        throw error
      }
    }
  }

  private async compensate(): Promise<void> {
    // Compensar en orden inverso
    for (const stepName of [...this.completedSteps].reverse()) {
      const step = this.steps.find(s => s.name === stepName)
      if (step) {
        await step.compensate()
      }
    }
  }

  private async persist(): Promise<void> {
    await Bun.write(this.persistPath, JSON.stringify({
      steps_completed: this.completedSteps,
      current_step: this.steps[this.completedSteps.length]?.name ?? null,
      updated_at: new Date().toISOString()
    }))
  }
}
```

**Uso en el pipeline:**

```typescript
const saga = new Saga(request.request_id, config.saga.persistence_path)

saga.addStep({
  name: 'create_branch',
  execute: () => git.checkoutBranch(`pipeline/${branch}`, branch),
  compensate: () => git.deleteLocalBranch(`pipeline/${branch}`, true)
})

saga.addStep({
  name: 'run_agents',
  execute: () => runAgents(request, tier),
  compensate: () => eventBus.publish({ event_type: 'pipeline.error', ... })
})

saga.addStep({
  name: 'merge_back',
  execute: () => git.checkout(branch).then(() => git.merge([`pipeline/${branch}`])),
  compensate: () => {} // Mantener pipeline/ para debug
})

await saga.execute()
```

### 7.7 Idempotencia — `Map` en memoria + archivo

No necesita libreria. Es un `Map<string, string>` que mapea `branch` a `request_id`:

```typescript
class IdempotencyGuard {
  private activePipelines = new Map<string, string>() // branch → request_id

  check(branch: string): { isDuplicate: boolean; existingRequestId?: string } {
    const existing = this.activePipelines.get(branch)
    if (existing) {
      return { isDuplicate: true, existingRequestId: existing }
    }
    return { isDuplicate: false }
  }

  register(branch: string, requestId: string): void {
    this.activePipelines.set(branch, requestId)
  }

  release(branch: string): void {
    this.activePipelines.delete(branch)
  }
}
```

Se persiste periodicamente con `Bun.write('.pipeline/active-pipelines.json', ...)` para recovery despues de crash.

### 7.8 Circuit Breaker — `cockatiel`

| Componente | Libreria | Version |
|---|---|---|
| **Circuit Breaker** | `cockatiel` | ^3 |

**Por que `cockatiel` y no `opossum`:**

| | `opossum` | `cockatiel` |
|---|---|---|
| TypeScript | Tipado basico | TypeScript-first, generics completos |
| API | Class-based (new CircuitBreaker(fn)) | Composable policies (wrap) |
| Retry | Separado | Integrado en la misma libreria |
| Bulkhead | No | Si |
| Tamano | 25kb | 12kb |
| Mantenimiento | Activo | Activo (Microsoft) |

`cockatiel` no solo da Circuit Breaker — tambien da Retry, Timeout, y Bulkhead. Son los patrones de resiliencia que necesitamos, todos en una sola libreria.

```typescript
import { CircuitBreakerPolicy, ConsecutiveBreaker, retry, handleAll, wrap } from 'cockatiel'

// Circuit breaker para Claude Code
const claudeBreaker = new CircuitBreakerPolicy(
  handleAll,
  new ConsecutiveBreaker(3)    // Abrir despues de 3 fallos consecutivos
)

claudeBreaker.onBreak(() => {
  logger.error({ source: 'circuit-breaker', action: 'circuit.open' }, 'Claude Code circuit OPEN')
})

claudeBreaker.onReset(() => {
  logger.info({ source: 'circuit-breaker', action: 'circuit.closed' }, 'Claude Code circuit CLOSED')
})

// Circuit breaker para GitHub API
const githubBreaker = new CircuitBreakerPolicy(
  handleAll,
  new ConsecutiveBreaker(5)
)

// Retry + Circuit breaker combinados
const githubPolicy = wrap(
  retry(handleAll, { maxAttempts: 3 }),
  githubBreaker
)

// Uso
const pr = await githubPolicy.execute(() =>
  octokit.pulls.create({ owner, repo, title, head, base, body })
)
```

### 7.9 Dead Letter Queue — Implementacion propia + `Bun.file()`

No hay librerias de DLQ standalone (las DLQ viven dentro de message brokers como RabbitMQ). Nuestra DLQ es basada en archivos:

```typescript
import { readdir, mkdir } from 'node:fs/promises'

class DeadLetterQueue {
  private basePath: string
  private maxRetries: number
  private baseDelay: number

  constructor(config: DLQConfig) {
    this.basePath = config.path
    this.maxRetries = config.max_retries
    this.baseDelay = config.base_delay_seconds * 1000
  }

  async enqueue(adapter: string, event: PipelineEvent, error: Error): Promise<void> {
    const dir = `${this.basePath}/${adapter}`
    await mkdir(dir, { recursive: true })

    const entry = {
      event,
      error: error.message,
      enqueued_at: new Date().toISOString(),
      retry_count: 0,
      next_retry_at: new Date(Date.now() + this.baseDelay).toISOString()
    }

    const file = Bun.file(`${dir}/${event.request_id}.jsonl`)
    const existing = await file.exists() ? await file.text() : ''
    await Bun.write(file, existing + JSON.stringify(entry) + '\n')
  }

  async processRetries(adapter: string, deliverFn: (event: PipelineEvent) => Promise<void>): Promise<void> {
    const dir = `${this.basePath}/${adapter}`
    const files = await readdir(dir).catch(() => [])

    for (const fileName of files) {
      const file = Bun.file(`${dir}/${fileName}`)
      const content = await file.text()
      const entries = content.trim().split('\n').map(line => JSON.parse(line))
      const latest = entries[entries.length - 1]

      if (latest.retry_count >= this.maxRetries) {
        eventBus.publish({
          event_type: 'adapter.delivery.failed',
          data: { adapter, event: latest.event, retries_exhausted: true }
        })
        continue
      }

      if (new Date(latest.next_retry_at) <= new Date()) {
        try {
          await deliverFn(latest.event)
          await Bun.write(`${dir}/${fileName}`, '') // Entregado — vaciar
        } catch (retryError) {
          const delay = this.baseDelay * Math.pow(3, latest.retry_count) // Exponential backoff
          const retryEntry = {
            ...latest,
            retry_count: latest.retry_count + 1,
            next_retry_at: new Date(Date.now() + delay).toISOString(),
            last_error: (retryError as Error).message
          }
          await Bun.write(file, content + JSON.stringify(retryEntry) + '\n')
        }
      }
    }
  }
}
```

---

## 8. Configuracion

| Componente | Libreria | Version |
|---|---|---|
| **YAML parser** | `yaml` | ^2 |
| **Validacion** | `zod` | ^3 |
| **Variables de entorno** | Bun (built-in) | — |

Bun lee `.env` automaticamente. No necesitamos `dotenv`.

### Por que `yaml` y no `js-yaml`

| | `js-yaml` | `yaml` |
|---|---|---|
| Spec | YAML 1.1 | YAML 1.2 (estandar actual) |
| TypeScript | Tipos externos | TypeScript nativo |
| Preserve comments | No | Si |
| Mantenimiento | Activo | Activo |

### Flujo de configuracion

```typescript
import { parse } from 'yaml'
import { z } from 'zod'

// Schema de configuracion con Zod
const ConfigSchema = z.object({
  pipeline: z.object({
    branch: z.object({
      prefix: z.string().default('pipeline/'),
      merge_back: z.boolean().default(true),
      delete_after_merge: z.boolean().default(true),
      keep_on_failure: z.boolean().default(true),
    }),
    tiers: z.object({
      small: z.object({
        max_files: z.number().default(3),
        max_lines: z.number().default(50),
        agents: z.array(z.string()),
      }),
      medium: z.object({
        max_files: z.number().default(10),
        max_lines: z.number().default(300),
        agents: z.array(z.string()),
      }),
      large: z.object({
        agents: z.array(z.string()),
      }),
    }),
    // ... resto del schema
  })
})

type PipelineConfig = z.infer<typeof ConfigSchema>

async function loadConfig(projectRoot: string): Promise<PipelineConfig> {
  const file = Bun.file(`${projectRoot}/.pipeline/config.yaml`)
  const raw = await file.text()
  const parsed = parse(raw)

  // Resolver variables de entorno (${VAR_NAME})
  const resolved = resolveEnvVars(parsed)

  // Validar contra el schema
  return ConfigSchema.parse(resolved)
}
```

### Resolucion de variables de entorno

El config.yaml usa `${VAR_NAME}` para secretos. Se resuelven al cargar. Bun ya tiene las variables de `.env` en `process.env`:

```typescript
function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? '')
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvVars)
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, resolveEnvVars(v)])
    )
  }
  return obj
}
```

---

## 9. Validacion de Schemas

| Componente | Libreria | Version |
|---|---|---|
| **Toda la validacion** | `zod` | ^3 |

Con Hono + `@hono/zod-validator`, **Zod es el unico sistema de validacion**. No hay dos niveles (Ajv + Zod como en Fastify). Un solo schema Zod valida tanto la estructura HTTP como las reglas de negocio.

```typescript
// Un solo schema — valida estructura Y negocio
const PipelineRunSchema = z.object({
  branch: z.string().min(1).refine(
    branch => !branch.startsWith('pipeline/'),
    'Branch cannot start with pipeline/'
  ),
  worktree_path: z.string().min(1),
  base_branch: z.string().default('main'),
  config: z.object({
    tier_override: z.enum(['small', 'medium', 'large']).nullable().optional(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
})

// Se usa en el endpoint directamente
app.post('/pipeline/run', zValidator('json', PipelineRunSchema), handler)
```

---

## 10. Webhook HTTP Client

| Componente | Libreria | Version |
|---|---|---|
| **HTTP client** | `fetch` (global en Bun) | — |

Bun tiene `fetch` global nativo. No necesitamos `axios`, `got`, ni `node-fetch`.

```typescript
// Enviar webhook al cliente
async function sendWebhook(url: string, event: PipelineEvent, token: string): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Pipeline-Event': event.event_type,
      'X-Request-ID': event.request_id,
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(10_000), // 10s timeout
  })

  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status} ${response.statusText}`)
  }
}
```

---

## 11. Filesystem y JSONL

| Componente | Herramienta | Detalle |
|---|---|---|
| **File I/O** | `Bun.file()` / `Bun.write()` | API optimizada de Bun |
| **JSONL parsing** | Implementacion propia | — |
| **File watching** | `chokidar` | ^4 |

### JSONL read/write con Bun

```typescript
// Escribir (append)
async function appendJsonl(path: string, obj: unknown): Promise<void> {
  const file = Bun.file(path)
  const existing = await file.exists() ? await file.text() : ''
  await Bun.write(file, existing + JSON.stringify(obj) + '\n')
}

// Leer
async function readJsonl<T>(path: string): Promise<T[]> {
  const file = Bun.file(path)
  if (!await file.exists()) return []
  const content = await file.text()
  return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as T)
}

// Leer por streaming (archivos grandes)
async function* streamJsonl<T>(path: string): AsyncGenerator<T> {
  const file = Bun.file(path)
  const stream = file.stream()
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as T
    }
  }

  if (buffer.trim()) yield JSON.parse(buffer) as T
}
```

### File watching con `chokidar`

Para detectar cuando el manifest.json cambia (util si procesos externos lo modifican):

```typescript
import chokidar from 'chokidar'

chokidar.watch('.pipeline/manifest.json').on('change', () => {
  // Re-leer manifest y notificar al Director
})
```

---

## 12. Testing

| Componente | Herramienta | Detalle |
|---|---|---|
| **Test runner** | `bun test` (built-in) | — |
| **HTTP testing** | `app.request()` (built-in de Hono) | — |
| **Mocks** | `bun:test` (built-in) | `mock`, `spyOn` |

### Por que `bun test`

Bun incluye un test runner que es compatible con la sintaxis de Jest/Vitest. No se necesita instalar nada.

| | Jest | Vitest | `bun test` |
|---|---|---|---|
| TypeScript | Via ts-jest | Via esbuild | Nativo |
| Velocidad | Lenta | Rapida | Mas rapida (nativa) |
| Instalacion | `npm i jest ts-jest` | `npm i vitest` | Ya incluido |
| Mocks | `jest.mock()` | `vi.mock()` | `mock()` de `bun:test` |
| Watch | `--watch` | `--watch` (HMR) | `--watch` |

### Testing del HTTP server

Hono incluye `app.request()` para testear endpoints sin levantar el server:

```typescript
import { test, expect } from 'bun:test'
import { app } from '../src/server'

test('POST /pipeline/run returns 202', async () => {
  const response = await app.request('/pipeline/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-token',
    },
    body: JSON.stringify({
      branch: 'feature/auth',
      worktree_path: '/tmp/test-worktree',
    })
  })

  expect(response.status).toBe(202)
  const json = await response.json()
  expect(json).toHaveProperty('request_id')
})
```

### Testing de patrones

```typescript
import { test, expect } from 'bun:test'

// State Machine
test('branch cannot skip from ready to merge_history', () => {
  const actor = createActor(branchMachine).start()
  actor.send({ type: 'PIPELINE_APPROVED' }) // → ready
  actor.send({ type: 'PR_MERGED' })         // Transicion invalida

  expect(actor.getSnapshot().value).toBe('ready') // No cambio
})

// Circuit Breaker
test('circuit opens after 3 consecutive failures', async () => {
  const breaker = new CircuitBreakerPolicy(handleAll, new ConsecutiveBreaker(3))

  const failingFn = () => { throw new Error('fail') }

  for (let i = 0; i < 3; i++) {
    await breaker.execute(failingFn).catch(() => {})
  }

  expect(breaker.execute(failingFn)).rejects.toThrow('Breaker') // Circuit open
})

// Saga compensation
test('saga compensates on failure', async () => {
  const compensated: string[] = []
  const saga = new Saga('test-123', '/tmp')

  saga.addStep({
    name: 'step1',
    execute: async () => {},
    compensate: async () => { compensated.push('step1') }
  })
  saga.addStep({
    name: 'step2',
    execute: async () => { throw new Error('boom') },
    compensate: async () => { compensated.push('step2') }
  })

  expect(saga.execute()).rejects.toThrow('boom')
  expect(compensated).toEqual(['step1']) // step2 nunca se ejecuto, step1 se compenso
})
```

---

## 13. Resumen de Dependencias

### Dependencias de produccion

| Libreria | Version | Patron / Componente | Proposito |
|---|---|---|---|
| `hono` | ^4 | HTTP Server | Framework web ultraligero |
| `@hono/zod-validator` | ^0.4 | Validacion HTTP | Validacion Zod en endpoints |
| `@anthropic-ai/claude-code` | latest | Claude Code | SDK para lanzar agentes de Claude Code |
| `simple-git` | ^3 | Git | Operaciones git programaticas |
| `@octokit/rest` | ^21 | GitHub | API de GitHub (PRs, comments, labels) |
| `eventemitter3` | ^5 | Observer/Pub-Sub | Event Bus en memoria |
| `pino` | ^9 | Logging | Logging estructurado JSON |
| `xstate` | ^5 | State Machine | Maquina de estados del manifiesto |
| `cockatiel` | ^3 | Circuit Breaker | Resiliencia (circuit breaker + retry) |
| `yaml` | ^2 | Configuracion | Parser YAML 1.2 |
| `zod` | ^3 | Validacion | Validacion de schemas en runtime |
| `chokidar` | ^4 | Filesystem | Watch de archivos |

### Dependencias de desarrollo

| Libreria | Version | Proposito |
|---|---|---|
| `pino-pretty` | ^13 | Pretty print de logs en desarrollo |
| `pino-abstract-transport` | ^2 | Base para transport custom de Pino |

### Dependencias opcionales (escalado)

| Libreria | Version | Cuando | Proposito |
|---|---|---|---|
| `ioredis` | ^5 | Event Bus distribuido | Redis Pub/Sub |
| `nats` | ^2 | Event Bus enterprise | NATS messaging |

---

## 14. Diagrama de Dependencias

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          PIPELINE SERVICE (Bun)                          │
│                                                                          │
│  ┌─ SERVER ───────────────────────────────────────────────────────────┐  │
│  │  hono + @hono/zod-validator                                        │  │
│  │  (CORS, Auth, SSE, Logger → built-in de Hono)                     │  │
│  └────────────────────────────────────┬───────────────────────────────┘  │
│                                       │                                  │
│  ┌─ CORE ─────────────────────────────┼────────────────────────────┐    │
│  │                                    │                             │    │
│  │  @anthropic-ai/claude-code ────── Lanza agentes                 │    │
│  │  simple-git ──────────────────── Operaciones git                │    │
│  │  @octokit/rest ───────────────── GitHub API                     │    │
│  │  zod ─────────────────────────── Validacion de negocio          │    │
│  │                                                                  │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                       │                                  │
│  ┌─ EVENT BUS ────────────────────────┼────────────────────────────┐    │
│  │  eventemitter3 ───────────────── Pub/Sub en memoria              │    │
│  │  Bun.file() / Bun.write() ────── Persistencia JSONL             │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                       │                                  │
│  ┌─ PATTERNS ─────────────────────────┼────────────────────────────┐    │
│  │  xstate ──────────────────────── State machine del manifiesto   │    │
│  │  cockatiel ───────────────────── Circuit breaker + retry         │    │
│  │  (propio) ────────────────────── Saga, Idempotencia, DLQ        │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                       │                                  │
│  ┌─ CONFIG ───────────────────────────┼────────────────────────────┐    │
│  │  yaml ────────────────────────── Parser config.yaml              │    │
│  │  Bun (.env) ──────────────────── Variables de entorno            │    │
│  │  zod ─────────────────────────── Schema validation               │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                       │                                  │
│  ┌─ LOGGING ──────────────────────────┼────────────────────────────┐    │
│  │  pino ────────────────────────── Logger JSON                     │    │
│  │  pino-pretty ─────────────────── Desarrollo                      │    │
│  │  (custom transport) ─────────── Separar logs por request_id      │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 15. package.json

```json
{
  "name": "pipeline-service",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/server.ts",
    "start": "bun src/server.ts",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "typecheck": "bun x tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4",
    "@hono/zod-validator": "^0.4",
    "@anthropic-ai/claude-code": "latest",
    "simple-git": "^3",
    "@octokit/rest": "^21",
    "eventemitter3": "^5",
    "pino": "^9",
    "xstate": "^5",
    "cockatiel": "^3",
    "yaml": "^2",
    "zod": "^3",
    "chokidar": "^4"
  },
  "devDependencies": {
    "pino-pretty": "^13",
    "pino-abstract-transport": "^2"
  }
}
```

**Total: 12 dependencias de produccion, 2 de desarrollo.** Bun elimina 6 dependencias que Node.js necesitaba (`dotenv`, `tsx`, `typescript`, `@types/node`, `vitest`, los plugins de Fastify). Hono elimina 3 mas (CORS, Auth, SSE como plugins).
