# Plan: Integrar GitHub Issues en Funny

## Resumen
Agregar un item "GitHub Issues" en el dropdown menu de cada proyecto del sidebar que abre un Dialog mostrando los issues de GitHub del repositorio. El sistema detecta automáticamente el owner/repo del remote URL del proyecto.

## Cambios por archivo

### 1. `packages/shared/src/types.ts` — Agregar tipo GitHubIssue
- Agregar interfaz `GitHubIssue` con campos: `number`, `title`, `state`, `body`, `created_at`, `updated_at`, `html_url`, `user` (login + avatar_url), `labels` (name + color), `comments`, `pull_request` (para filtrar PRs)

### 2. `packages/server/src/routes/github.ts` — Agregar endpoint de issues
- Agregar función `parseGithubOwnerRepo(remoteUrl)` que extrae `owner/repo` de URLs HTTPS y SSH de GitHub
- **`GET /issues`** — Lista issues de un repo. Query params: `projectId` (requerido), `state` (open/closed/all, default open), `page`, `per_page`. Internamente:
  1. Buscar el proyecto por ID para obtener su `path`
  2. Ejecutar `getRemoteUrl(path)` para obtener el remote
  3. Parsear owner/repo del remote
  4. Si hay token GitHub del usuario, usarlo; si no, intentar sin auth (repos públicos)
  5. Llamar a `GET /repos/{owner}/{repo}/issues` de la GitHub API
  6. Retornar `{ issues: GitHubIssue[], hasMore: boolean }`

### 3. `packages/client/src/lib/api.ts` — Agregar método API del cliente
- Agregar `githubIssues(projectId, params?)` que llama a `GET /github/issues`

### 4. `packages/client/src/components/sidebar/ProjectItem.tsx` — Agregar item en dropdown
- Importar icono `CircleDot` de lucide-react (similar al icono de issues de GitHub)
- Agregar un `DropdownMenuItem` en el menú de tres puntos del proyecto, entre "Analytics" y el separator, con icono `CircleDot` y texto "GitHub Issues"
- Al hacer click, llama `onShowIssues()` (nuevo callback en props)

### 5. `packages/client/src/components/IssuesDialog.tsx` — Nuevo componente Dialog
- Dialog con lista de issues del proyecto
- Header: título "GitHub Issues" + filtro por estado (Open/Closed) usando botones
- Body: ScrollArea con lista de issues mostrando:
  - Icono de estado (open=verde, closed=púrpura)
  - Número (#123) + título
  - Labels como badges de color
  - Fecha relativa + autor
  - Conteo de comentarios si > 0
- Footer: Link "View on GitHub" que abre el repo en el navegador
- Estado de carga con Loader2 spinner
- Estado vacío si no hay issues
- Manejo de error (repo no es de GitHub, sin conexión, etc.)
- Paginación simple (botón "Load more")

### 6. `packages/client/src/components/Sidebar.tsx` — Integrar el dialog
- Agregar estado `issuesProjectId` para controlar qué proyecto muestra issues
- Pasar `onShowIssues` callback al `ProjectItem`
- Renderizar `<IssuesDialog>` cuando `issuesProjectId` no es null

### 7. Traducciones — Agregar strings en los 3 idiomas (en, es, pt)
- Claves: `sidebar.githubIssues`, `issues.title`, `issues.open`, `issues.closed`, `issues.noIssues`, `issues.loadMore`, `issues.viewOnGithub`, `issues.notGithub`, `issues.error`

## Flujo del usuario
1. Hover sobre proyecto en sidebar → aparecen botones de acción
2. Click en menú de tres puntos (⋯) → aparece "GitHub Issues" en el dropdown
3. Click en "GitHub Issues" → se abre un Dialog con los issues del repo
4. El dialog muestra issues abiertos por defecto, con opción de filtrar por closed
5. Cada issue es clickeable y abre el issue en GitHub en nueva pestaña

## Notas técnicas
- No se necesita token de GitHub para repos públicos (la API pública permite ~60 req/hora)
- Si el usuario tiene token configurado, se usa para mayor rate limit y acceso a repos privados
- Si el remote no es de GitHub, se muestra un mensaje informativo
- No se requiere base de datos nueva ni WebSocket events
