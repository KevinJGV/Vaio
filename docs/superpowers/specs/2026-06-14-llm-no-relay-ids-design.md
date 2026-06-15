# Diseño técnico — "El modelo triggerea, el sistema gestiona los datos" + flujo de facts uuid-free

> **Altitud:** spec técnico (firmas, mapeo, edge-cases). Plan de alto nivel + estrategia →
> [`2026-06-14-llm-no-relay-ids-plan.md`](2026-06-14-llm-no-relay-ids-plan.md).
> **Disparador:** el e2e Telegram de la adjudicación de facts
> ([`2026-06-14-facts-conflict-adjudication-design.md`](2026-06-14-facts-conflict-adjudication-design.md))
> reveló el anti-patrón: el modelo no pudo relayar los uuids → la invalidación nunca ocurrió.

## El principio (a documentar como invariante)
**Los LLM no son confiables relayando datos específicos/estructurados (ids, uuids, objetos, arrays):** su
naturaleza generativa abre una ventana de fallo en cada estructura que deben emitir. Por eso, **toda lógica que
requiera ids/uuids/objetos se gestiona DETERMINÍSTICAMENTE** (cache/persistencia del sistema); las tools del
modelo exponen **solo intención** (lenguaje natural) + **opciones preestablecidas** (enum / ordinal pequeño /
boolean). **Excepciones: pocas y controladas** — selección de opciones preestablecidas, o datos de **baja
cardinalidad con fallo VISIBLE** (nunca silencioso). Cada tool nueva se audita contra esto.

## Auditoría (estado de partida)
| Tool | Campo | Tipo | Veredicto |
|---|---|---|---|
| `searchMemory` | `query` | string | ✅ lenguaje natural |
| `proposeFact` | `statement` | string | ✅ lenguaje natural |
| `commitFact` | `id` | uuid | 🔴 el modelo relaya un uuid (fallo) |
| `commitFact` | `supersedes` | uuid[] | 🔴 array de uuids → invalida el equivocado **en silencio** |
| `checkRepoFreshness`/`syncRepo` | `owner`,`repo` | string | 🟡→✅ **HECHO (2026-06-15)**: ahora `repo` es un `z.enum` cerrado de los slugs curados (ver abajo) |
| `recentActivity` | — | — | ✅ sin args |

## Rediseño del flujo de facts (uuid-free)
El **puerto `FactStore` NO cambia** (`propose`/`commit`/`reject`/`listPending` siguen usando ids internamente —
es código determinístico del sistema). Cambia solo la **capa de actions** (interfaz del modelo) + el prompt.

### `rememberFact` (reemplaza `proposeFact`)
`{ statement: z.string().min(1) }` — solo lenguaje natural. Orquesta sobre el `FactStore`:
```
const { id, conflicts } = await factStore.propose({ statement, principalId, channel, ... })
if (conflicts.length === 0) {
  await factStore.commit(id)            // guarda en el acto (reusa el embedding del propose)
  return "Listo, lo guardé en mi memoria."
}
return "Lo dejé pendiente — chocaría con:\n" + conflicts.map((c,i)=>`  [${i}] «${c.statement}»`) +
       "\nPreguntale al usuario si reemplaza alguno; cuando confirme, resolveFact."
```
- Sin conflicto → **auto-save** server-side (sin id del modelo, sin 2ª llamada, sin pedir confirmación).
- Con conflicto → pendiente + conflictos **numerados por ordinal** (sin uuids).
- `sideEffecting:true`, `clearance:"owner"`. Degradación: `factStore:null` → cortesía.

### `resolveFact` (reemplaza `commitFact`)
`{ decision: z.enum(["confirm","reject"]), replaces: z.array(z.number().int().nonnegative()).optional(),
which: z.number().int().nonnegative().optional() }` — **enum + ordinales pequeños, NUNCA un uuid**.
```
const pend = await factStore.listPending(principal.id)      // determinístico, más reciente primero
const target = pend[which ?? 0]
if (!target) return "No tengo ninguna propuesta pendiente."
if (decision === "reject") { await factStore.reject(target.id); return "Ok, lo descarté." }
// confirm: mapear ordinales → uuids de los conflictos QUE EL SISTEMA conoce (target.conflicts)
const supersedes = (replaces ?? [])
  .map((i) => target.conflicts[i]?.id)
  .filter((id): id is string => Boolean(id))            // descarta fuera de rango → no rompe
const ok = await factStore.commit(target.id, { supersedes })
return ok ? (supersedes.length ? "Listo, lo guardé y reemplacé el anterior." : "Listo, lo guardé.")
          : "No encontré esa propuesta pendiente (quizá ya se resolvió)."
```
- El modelo pasa ordinales; **el sistema mapea ordinal→uuid** desde `target.conflicts` (que ya computó en
  `listPending`). El modelo nunca toca un uuid.
- HITL estructural preservado: `resolveFact` exige una pendiente real (no se fabrica).

### Consistencia de ordinales
El prompt numera los conflictos en el orden de `target.conflicts` (de `listPending`); `resolveFact` mapea contra
el **mismo** `listPending` (mismo turno, orden determinístico por distancia coseno + tie-break por id). Misma
fuente → mismos ordinales. (El embedding del pending está guardado → recompute estable.)

## Prompt (`core/prompt.ts`)
El bloque de pendientes **deja de mostrar uuids**. Numera conflictos por ordinal e instruye usar
`resolveFact(decision, replaces:[ordinales])`. Varias pendientes → numerarlas (ordinal de `which`).

## Capabilities / registry
`ToolName` (`capabilities.ts`): `"searchMemory" | "rememberFact" | "resolveFact" | …`. Perfil **owner** expone
las dos nuevas (capa canal); `clearance:"owner"` (capa principal). `ACTIONS` (`registry.ts`) reemplaza
`proposeFact`/`commitFact`. Archivos: `propose-fact.ts`→`remember-fact.ts`, `commit-fact.ts`→`resolve-fact.ts`.

## Tools de repos uuid-free (2026-06-15 — cierra el diferido 🟡)
`checkRepoFreshness`/`syncRepo` dejan de tomar `owner`/`repo` como strings libres. El modelo elige de un **set
cerrado**: `inputSchema` = `z.object({ repo: z.enum(slugs) })` con `slugs = knownRepos.map("owner/repo")`
(`ActionContext.knownRepos` = `rawSourceRepos(env)`, los repos curados de `RAW_SOURCE_REPOS`). El sistema mapea el
slug elegido → su `RepoSyncSpec` (`resolveKnownRepo`, `core/actions/repo-select.ts`) y usa `{owner,repo}` como
antes. `knownRepos` vacío → `inputSchema: z.object({})` + degradación ("no tengo repos que conozca"). El enum
rechaza typos de casing y repos arbitrarios (verificado por smoke). `isTracked` queda como guard interno.
Followup (fuera de alcance): si se agrega ingesta on-demand de repos arbitrarios (paso 3 parte 2), el enum
estático no alcanza → ese repo entra por otro flujo con su propia confirmación (el modelo seguirá sin pasar el id crudo).

## Guard de durabilidad
Nota en `core/actions/types.ts` (doc de `ActionDescriptor`): **inputSchema = intención (lenguaje natural) +
opciones preestablecidas (enum/ordinal/boolean); NUNCA ids/uuids/objetos que el modelo deba relayar** — gestión
determinística vía persistencia/cache. Auditar cada tool nueva.

## Edge-cases
- **Sin pendiente al `resolveFact`** → "No tengo ninguna propuesta pendiente." (no rompe.)
- **`replaces` fuera de rango / vacío** → se descarta el ordinal inválido; confirm sin supersedes = coexistencia.
- **Varias pendientes** → `which` (ordinal, default 0 = la más reciente). El prompt las numera.
- **Auto-save (sin conflicto)**: `rememberFact` hace `propose`+`commit` en un turno; la pendiente es transitoria.
- **`factStore:null`** → cortesía (igual que hoy).
- **Ruido de falsos conflictos**: el modelo decide QUÉ ordinales pasar (sigue siendo el juez); el ordinal solo
  hace robusto el relay (no lo decide el sistema — la distancia coseno no separa real de falso).

## Testing (TDD)
Actions (fake `FactStore`):
1. `rememberFact` sin conflicto → guarda directo (listPending vacío después; texto "guardé").
2. `rememberFact` con conflicto → queda pendiente + el texto numera los conflictos por ordinal.
3. `resolveFact(confirm, replaces:[0])` → mapea al uuid del conflicto 0 y lo invalida (vía fake).
4. `resolveFact(confirm)` sin replaces → confirma sin invalidar (coexistencia).
5. `resolveFact(reject)` → rechaza la pendiente.
6. `resolveFact` sin pendiente → texto "no tengo pendiente".
7. `resolveFact(confirm, replaces:[99])` (fuera de rango) → ignora, confirma sin invalidar.
Prompt: bloque numera conflictos por ordinal, **sin uuids visibles**, menciona `resolveFact`/`replaces`.
Capabilities/registry: perfil owner expone `rememberFact`/`resolveFact`; ausentes en web/visitante.

## Invariantes
- Siempre responde (cortesía ante cualquier fallo). Bi-temporal (invalidar = marcar). ports/adapters-lite (la
  resolución determinística vive en actions/adapter, no en el modelo).
