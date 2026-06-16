# Design (VISIÓN) — Capa de complemento de la memoria: "Detectores de conocimiento disponible"

> **Roadmap de incrementos + estrategia de ejecución:** [`2026-06-15-knowledge-detectors-plan.md`](2026-06-15-knowledge-detectors-plan.md).
> Este doc = **visión arquitectónica + contratos** (bajo nivel). Es el NORTE que guía los incrementos; cada
> detector concreto tendrá su propio par design+plan cuando se priorice. **NO se implementa con este doc.**

## Problema / norte
Kevin (2026-06-15): que Vaio obtenga feedback de **múltiples frentes** → sensación de "IA omnisciente a la que no
se le escapa nada", **complementando** la memoria de la DB con data que el **sistema detecta solo** como de **otras
fuentes**, **sin convertir `searchMemory`/`learnRepo` en una amalgama** (separación de responsabilidades estricta).
Lo destapó **ACME**: ante "hablame de ACME", `searchMemory` trajo solo la **descripción** del conector `github`
(contenido fino) y Vaio **se conformó** — nada le avisó que existía un repo `KevinJGV/ACME` **no indexado** del que
podía traer el contenido completo (`learnRepo`). Kevin tuvo que pedírselo explícito.

## Insight central — DOS tipos de conocimiento
1. **CONTENIDO** (lo que YA está en memoria): chunks RAG (`repo:*`, descripciones de connectors `github`/`lastfm`/…,
   `trend:*`) + `facts`. Lo trae **`searchMemory`** (vector + rerank + `searchFacts`). = la memoria de la DB.
2. **SEÑALES DE DISPONIBILIDAD** (lo que EXISTE pero no está cargado / está atrás / es solo metadata / es consultable
   en vivo). Hoy **casi no existe**, salvo el **precedente** `behindNote` (el sistema detecta staleness e informa al
   modelo). El gap de ACME = una señal #2 faltante.

**La capa nueva gestiona SOLO el tipo #2** y deja el #1 como está. El modelo lee las señales (notas del sistema) y
decide **jalar más** (learnRepo, etc.). Sistema **detecta + informa**; el modelo **no orquesta** (Invariante #9).

## Contratos (puerto nuevo)
```ts
// ports/knowledge-detector.ts
export interface DetectContext {
  query: string            // la query del turno (la que el modelo pasó a searchMemory)
  retrievedSources: string[] // los `source` que searchMemory YA trajo (repo:*, github, fact, trend:*, …)
}
export interface DetectionHint {
  note: string             // "[nota del sistema: …]" que el modelo lee y acciona (sugiere una tool/acción)
}
export interface KnowledgeDetector {
  name: string
  /** Probe BARATO, best-effort: ¿hay una señal de disponibilidad para este turno? null = nada que reportar.
   *  NUNCA tira (catch interno) ni bloquea (trabajo caro = background). */
  detect(ctx: DetectContext): Promise<DetectionHint | null>
}
export interface DetectorRegistry {
  /** Corre todos los detectores en paralelo (best-effort), recorta a un cap de N notas, devuelve las notas. */
  run(ctx: DetectContext): Promise<string[]>
}
```

## La costura (dónde corre) — limpia, NO amalgama
- `searchMemory` **recupera contenido** (su único fin) y luego **delega** a `ctx.detectors?.run({query, sources})`
  (UNA línea), anteponiendo las notas al output (mismo lugar donde hoy va el `behindNote`). searchMemory **NO
  implementa** detectores → sigue limpio.
- **Migración que LIMPIA lo actual:** el freshness gate (`ensureFresh` + `behindNote`, hoy embebido en searchMemory)
  se **EXTRAE** a un `FreshnessDetector` → **searchMemory queda MÁS limpio que hoy**.
- `ActionContext` deja de crecer con N puertos sueltos por cada fuente: gana **UN** dep
  (`detectors?: DetectorRegistry | null`); cada detector encapsula los puertos que necesita (cableados en `index.ts`).
- (Futuro) detectores **pre-turno** (query-independientes del retrieval) podrían correr en el agent-loop e inyectar
  notas al system prompt — diferido hasta que un caso lo pida.

## Detectores — cada uno una UNIDAD con un solo fin
| Detector | Señal | Reusa | Estado |
|---|---|---|---|
| **FreshnessDetector** | un `repo:*` recuperado está atrás → nota + sync bg | `RepoSyncPort.ensureFresh`/`behind` (ya existe) | extraer de searchMemory |
| **UnindexedRepoDetector** (ACME) | la query matchea un repo del owner NO indexado → "tenés X sin indexar → learnRepo" | `OwnerRepoCatalog.listPublic` + `resolveRepoName` + `RepoSyncPort.isTracked` | 1er incremento |
| **ThinContentDetector** | lo recuperado de un repo es SOLO la descripción del conector `github`, no `repo:*` → "es solo la descripción; learnRepo para el código" | `retrievedSources` + catálogo | futuro |
| **LiveMetadataDetector** | la query es sobre CI/PRs/topics/lenguajes (no cubrible por el índice) → "puedo consultar GitHub en vivo" | el pendiente "queries vivas a GitHub" | futuro (atado a ese pendiente) |

**Contenido vs señal NUNCA se mezclan:** un detector produce una **NOTA (puntero)**, jamás contenido; `learnRepo`/
`searchMemory` siguen single-purpose. Sumar una fuente = sumar un detector (+ quizá su tool de pull), sin tocar searchMemory.

## Invariantes / no-negociables
- **#8:** notas en lenguaje natural + acciones preestablecidas (tools); el modelo nunca relaya ids; el sistema
  resuelve (p.ej. `resolveRepoName` mapea el nombre → repo real).
- **#9:** detectores auto-contenidos; el modelo lee y decide; cero orquestación de detección por el modelo.
- **#1:** probes baratos, best-effort, nunca tiran ni bloquean; el trabajo caro (sync, fetch live) queda en background.
- **Privacidad:** un detector sobre repos respeta **público-only** (reusa el filtro de `OwnerRepoCatalog`); nunca
  surfacea la existencia de repos privados en canales públicos.

## Edge-cases / decisiones diferidas (para los incrementos)
- **Match query→repo** (`UnindexedRepoDetector`): la query es una FRASE ("hablame de ACME" → query "ACME"); pero a
  veces es descriptiva. `resolveRepoName` espera un nombre → hace falta extraer candidato(s) de la query y umbral
  **conservador** (no falsos positivos: no sugerir learnRepo en cada turno). Quizá solo disparar si el match es fuerte.
- **Cap / orden de notas**: máximo N por turno (no inundar el contexto); prioridad si hay varias (staleness vs
  unindexed vs thin).
- **Costo**: los detectores corren cada turno → deben ser baratos (cache TTL del catálogo ya existe; freshness ya
  tiene TTL). Si un detector necesita red, cachear.
- **Ruido de retrieval** (problema #2 del caso ACME — basura del portafolio en queries de tema): NO es de esta capa
  (es calidad de rerank/recuperación); su propio followup.

## Cómo enchufan fuentes futuras
Una fuente nueva (p.ej. "queries vivas a GitHub": CI/PRs/topics/deploys) entra como (a) un **detector** que señala
"esto se puede consultar en vivo" + (b) su **tool de pull** (parametrizada, Invariante #8). La capa de detectores es
el lugar donde "el sistema sabe qué frentes pueden aportar" — el registro de la omnisciencia, con cada frente aislado.
