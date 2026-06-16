# Design (TÉCNICO) — `repo-awareness` detector: estados unindexed | stale | incompleto

> **Plan de alto nivel + estrategia de ejecución:** [`2026-06-15-repo-awareness-states-plan.md`](2026-06-15-repo-awareness-states-plan.md).
> Este doc = **diseño técnico de bajo nivel** (firmas, máquina de estados, edge-cases). Incremento 3 de la
> [capa de detectores](2026-06-15-knowledge-detectors-design.md) (tras fundación+ACME y repo-awareness a+b+findRepos).

## Problema (los dos puntos ciegos)
La "conciencia de repos" hoy solo cubre **unindexed**. Faltan dos estados del repo NOMBRADO:

1. **Stale nombrado-pero-no-recuperado.** Preguntás por un repo indexado y stale cuyos chunks NO salieron
   este turno → ni `UnindexedRepoDetector` (está trackeado → se calla) ni `FreshnessDetector` (mira solo
   `retrieved`) disparan.
2. **Incompleto/cap-bajo.** La frescura es **por SHA de commit** (`compareFreshness`): un repo cap-bajo
   (p.ej. `KevinJGV/Vaio` en 444 chunks del e2e) tiene el SHA del HEAD → reporta `"fresh"` aunque le falten
   archivos. Peor: `ensureFresh` **solo sincroniza si `state==="stale"`** → un repo SHA-fresh-pero-incompleto
   **nunca se completa solo**. (`lastStatus="partial"` hoy = "árbol truncado", no "cortado por el cap".)

**Norte:** un detector cohesivo del eje "repo nombrado" que clasifique su estado y, vía el SISTEMA (Inv #9),
dispare la acción correcta en background — el modelo solo lee la nota.

## Contratos / firmas

### 1. Helper PURO — `core/repo-sync.ts`
```ts
/** Paths que DEBERÍAN estar indexados pero no lo están (kept − indexados − tombstones).
 *  Medida EXACTA (sin umbral): todo archivo kept no-tombstoned debería tener ≥1 chunk; si no, lo dropeó el
 *  cap (maxChunksPerRepo). Reusa filterTree (la verdad de "qué debe estar indexado"). PURO (sin red/DB).
 *  El caller decide qué hacer con árbol truncado (no llamarlo / ignorar). */
export function coverageGap(
  currentTree: TreeEntry[],
  indexed: IndexedFile[],
  skipped: { path: string }[],
  policy: RepoIngestPolicy,
): string[]
```
Implementación: `kept = filterTree(currentTree, policy).kept`; `have = new Set(indexed.map(f=>f.path))`;
`tomb = new Set(skipped.map(s=>s.path))`; return `kept.map(e=>e.path).filter(p => !have.has(p) && !tomb.has(p))`.

> **Nota cap-vs-cobertura:** `coverageGap` cuenta ARCHIVOS faltantes, no chunks. Un archivo cap-dropeado no
> tiene NINGÚN chunk (el `break` corta antes de empezarlo o `slice(0, remaining)` con remaining>0 deja ≥1).
> En la práctica el cap dropea archivos enteros del orden de prioridad → faltan paths completos → detectable.

### 2. Puerto — `ports/repo-sync.ts`
```ts
export interface RepoReadiness { state: "fresh" | "stale" | "incomplete" | "untracked" }

export interface RepoSyncPort {
  // … existentes …
  /** Para un repo NOMBRADO por el usuario: clasifica su estado y DISPARA la acción (Inv #9):
   *  incompleto → incremental `ignoreFresh` bg; stale → incremental bg; fresh/untracked → no-op. TTL-gated (comparte el
   *  lastChecked de ensureFresh). best-effort: nunca tira (error → "fresh", sin acción). */
  ensureRepoReady(spec: RepoSyncSpec): Promise<RepoReadiness>
}
```
**No** cambia la firma de `sync` (el `forceFull` se dispara internamente vía `guardedSync`).

### 3. Adapter — `createRepoSync` en `adapters/sources/repo-sync.ts`
```
ensureRepoReady(spec):
  source = `repo:${owner}/${repo}`
  if inFlight.has(source): return { state: "stale" }   // ya sincronizando (de un turno previo) → sigue atrás
  tracked = await tracker.get(source)
  if !tracked?.lastCommitSha: return { state: "untracked" }   // 0 requests GitHub
  if lastChecked TTL vigente: return { state: "fresh" }       // ya sondeado hace poco (comparte gate)
  lastChecked.set(source, now)
  try:
    branch = spec.branch ?? tracked.branch
    tree   = await githubApi(`/repos/${slug}/git/trees/${branch}?recursive=1`)   // cobertura primero
    if !tree.truncated:
      gap = coverageGap(tree.tree→TreeEntry[], await memory.listIndexedFiles(source), tracked.skipped ?? [], policy)
      if gap.length > 0:
        void guardedSync(spec, { ignoreFresh: true }).catch(()=>{})   # NO forceFull (ver nota)
        return { state: "incomplete" }
    head = await remoteHead(slug, branch)                       // freshness por SHA
    if compareFreshness(head, tracked.lastCommitSha).state === "stale":
      void guardedSync(spec).catch(()=>{})                       // incremental bg
      return { state: "stale" }
    return { state: "fresh" }
  catch: return { state: "fresh" }                               // degrada silencioso (Inv #1)
```
Reusa: `guardedSync`, `parseRepoSource`, `remoteHead`, `compareFreshness`, `lastChecked`, `inFlight`, `policy`.

> **`ignoreFresh` vs `forceFull` (APRENDIDO del e2e por Telegram, 2026-06-15 — corrige el diseño original):**
> un repo INCOMPLETO es **SHA-fresh** (`lastCommitSha == HEAD`) pero le faltan archivos (el cap
> `maxChunksPerRepo` es POR-CORRIDA → un repo grande converge en varias pasadas). Por eso:
> - `forceFull` ❌ — `clearSource` + re-index por orden de prioridad re-haría el MISMO prefijo de archivos y
>   **nunca progresaría** (y borra todo un instante).
> - incremental común ❌ — el gate de frescura de `syncRepo` haría `skipped-fresh` (SHA fresh) → 0 embeddings.
> - **`ignoreFresh` ✅** — saltea el gate de frescura pero corre el diff INCREMENTAL (isFull=false): appendea
>   SOLO los faltantes sin borrar lo indexado → **progresa** cada pasada hasta completar.
> El flag se suma a `syncRepo`/`guardedSync` opts; `stale` (SHA cambiado, no es fresh) usa el incremental normal.

### 4. Detector — `core/detectors/repo-awareness.ts` (rename de `unindexed-repo.ts`)
- Factory `createRepoAwarenessDetector({ ownerRepos, ownerUser, repoSync })`; `name: "repo-awareness"`.
- Mantiene `reposMentionedInGithub` + el cómputo de `retrievedNames`/`notRetrieved`.
- Para cada repo candidato (señal 1 `reposNamedInQuery` ∪ señal 2 `reposMentionedInGithub`) que cumpla
  `notRetrieved`: `state = await repoSync.ensureRepoReady({ owner: ownerUser, repo: r.name })` → hint:

| state        | hint.note                                                                              |
|--------------|----------------------------------------------------------------------------------------|
| `untracked`  | (la actual) "tenés/mencionaste el repo público X que NO tengo indexado → learnRepo"     |
| `incomplete` | "tengo el repo X indexado solo PARCIALMENTE (le faltan archivos); lo estoy completando en background — puede que aún no tenga todo su código, aclaralo si hace falta" |
| `stale`      | "tu copia del repo X está un poco atrás de GitHub; ya se actualiza sola en background — respondé con lo que tenés, y si depende de cambios muy recientes aclaralo al pasar, sin dramatizar" |
| `fresh`      | (sin hint)                                                                              |

  Cada hint lleva `repo: r.name` → el registry deduplica (1 nota/repo). Se devuelve la PRIMERA señal con
  hint (orden: señal-nombre antes que señal-contenido, como hoy). Se elimina el helper `notTracked` (ahora
  `ensureRepoReady` devuelve `"untracked"`).

## Edge cases
- **Árbol truncado** → no confiar en `coverageGap` (ausencia puede ser truncamiento) → solo SHA (fresh/stale).
- **Stale + incompleto** → `forceFull` (lo trae fresh + completo) → `"incomplete"`; prioridad incomplete>stale.
- **Error en cualquier probe** → `"fresh"` (Inv #1; sin acción, sin nota).
- **TTL compartido** con `ensureFresh` → un repo recién chequeado no se re-sondea (evita doble request).
- **In-flight** → si ya hay sync corriendo → `"stale"` (sigue atrás) sin disparar otro (el guard ya lo cubre).
- **Sin solape con `FreshnessDetector`**: repo-awareness solo actúa sobre `notRetrieved`; el registry además
  dedup por `repo`. El `FreshnessDetector` sigue intacto (eje *recuperado*).

## Costo
Por repo NOMBRADO+trackeado y fuera de TTL: hasta 2 requests GitHub (árbol + commit). Acotado por TTL (10 min)
+ solo cuando un repo se nombra/menciona explícitamente. Untracked = 0 requests. Aceptable (tráfico bajo).

## Testing
- `coverageGap` PURO (core): completo (0 faltantes) · cap-bajo (faltan paths) · con tombstones (no cuentan) ·
  árbol truncado (caller lo ignora — test del caller, no del helper).
- `repo-awareness.detect` con `RepoSyncPort` **fake** (ensureRepoReady scripteado): un test por estado
  (untracked/incomplete/stale/fresh) + dedup (1 nota/repo) + guard `notRetrieved` + ambas señales
  (nombrado/mencionado). Sin GitHub real (el I/O está detrás del puerto).
- Smoke de `ensureRepoReady` (wiring): con fakes de tracker/memory/github → clasifica y dispara.
