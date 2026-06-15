# "El modelo triggerea, el sistema gestiona los datos" — Plan de alto nivel

> **For agentic workers:** TDD, commits frecuentes. Diseño técnico (firmas, mapeo ordinal→uuid, edge-cases,
> tests) → [`2026-06-14-llm-no-relay-ids-design.md`](2026-06-14-llm-no-relay-ids-design.md) (NO se repite).

**Goal:** establecer el principio "el modelo solo triggerea; los ids/uuids/objetos se gestionan
determinísticamente" como invariante documentado, y aplicarlo a la violación crítica (flujo de facts) volviéndolo
**uuid-free** (`rememberFact`/`resolveFact` con lenguaje natural + ordinales).

## Fases (secuencia con dependencias)
1. **Documentar el principio** — invariante en `CLAUDE.md`, sección en `docs/SPEC.md`, memoria `llm-no-relay-ids`,
   nota-guard en `core/actions/types.ts`. *(Independiente; primero para fijar el norte.)*
2. **`rememberFact`** (de `propose-fact.ts`) — auto-commit sin conflicto; conflictos numerados por ordinal. *(TDD.)*
3. **`resolveFact`** (de `commit-fact.ts`) — resolución determinística de la pendiente + mapeo ordinal→uuid. *(TDD.)*
4. **Registry + capabilities** — `ACTIONS`, `ToolName`, perfil owner → renombres. *(Rompe typecheck hasta cerrar
   2+3+4 juntos; mismo PR.)*
5. **Prompt** — bloque de pendientes por ordinal, sin uuids; guía de `resolveFact`/`replaces`. *(Depende de 3.)*
6. **Tests** — actions (7 casos), prompt, capabilities/registry. *(Junto con 2-5.)*
7. **Verificación + e2e** — suite + e2e uuid-free contra Neon (ver design §Testing y plan §Verification).

## Entregables
- Principio escrito (invariante + SPEC + memoria + guard).
- Flujo de facts uuid-free: el modelo nunca pasa un uuid (solo statement, enum, ordinales).
- Tests nuevos verdes; suite total sin regresión; puerto/adapter `facts` intactos.
- e2e Neon: rememberFact auto-guarda; resolveFact mapea ordinal→uuid e invalida el correcto.

## Estrategia de ejecución (OBLIGATORIA)
**Directo / secuencial (yo-orquestador), NO subagentes en paralelo.** Justificación:
- **Subsistema acoplado por el rename**: `registry`, `capabilities`, las 2 actions y sus tests comparten los
  nombres nuevos → cambiar uno rompe typecheck en cascada hasta cerrar todos (el hook `PostToolUse` encadena).
  Subagentes en paralelo se pisarían.
- **Cambios chicos y dependientes** (3 depende de listPending/conflicts ya existentes; 5 del 3). Sin paralelismo real.
- **Riesgo concentrado** en el mapeo ordinal→uuid (resolveFact) — conviene una sola cabeza con todo el contexto.
La auditoría amplia (Fase 1) SÍ usó un subagente Explore (trabajo de barrido independiente) — la implementación, no.

## Verificación
typecheck/biome/test/build limpios + e2e uuid-free contra Neon (rememberFact sin/con conflicto; resolveFact
confirm+replaces[0] invalida el correcto; ordinal fuera de rango se ignora; searchMemory ya no trae el invalidado)
+ re-test owner por Telegram (Kevin: el modelo pasa ordinales, no uuids). Diferido anotado: tools de repos.
