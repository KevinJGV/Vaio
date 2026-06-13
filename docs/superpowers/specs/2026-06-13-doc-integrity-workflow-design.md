# Diseño técnico — Workflow de integridad documental (anti-drift) · 2026-06-13

Spec **técnico**. Plan/altitud alta → [`…-doc-integrity-workflow-plan.md`](2026-06-13-doc-integrity-workflow-plan.md).
Las **reglas** (single-source-of-truth, estados WIP, gate al cambiar de foco, DoD) viven en `CLAUDE.md`
→ "Integridad documental (anti-drift)"; acá va el **cómo** (scripts/hooks/CI), sin duplicar las reglas.

## Problema
Docs se desfasaban del código → errores en sesiones futuras. Y al pivotar el foco quedaban pendientes
sueltos (deuda documental). Ver causas raíz en `LEARNINGS.md` → "Integridad documental".

## Componentes

### 1. Estado como dato mínimo (estructural) — `docs/NEXT-STEPS.md`
- `> **ESTADO ACTUAL (YYYY-MM-DD)**` (bloque vivo, chico) · `## 🚧 En proceso / verificación` (lista WIP) ·
  `## Historial …` (inmutable, snapshots datados). `SPEC`/`CLAUDE.md` no llevan estado → apuntan acá.
- **Estados WIP greppables** (ASCII, regex `^- \[[ ~?x]\] `): `[ ]` pendiente · `[~]` parcial · `[?]`
  pend. verificación de Kevin · `[x]` verificado (→ mover al Historial).

### 2. `scripts/check-docs.sh` (CI + a mano; `set -uo pipefail`)
- **[1] cross-links de specs (FALLA):** `grep -hoE 'superpowers/specs/[A-Za-z0-9._-]+\.md' docs/*.md`,
  verifica `-f docs/$ref`. Recolecta en var vía `while … done < <(...)` (process-substitution, NO pipe →
  no se pierde la var en subshell). Shorthand con `{design,plan}`/`…-` no matchea (intencional, evita FP).
- **[2] contradicción (FALLA):** "Fase 1 … scaffold" mientras `apps/agent/src/core/agent.ts` existe.
  Escanea SOLO los docs que afirman estado actual (`CLAUDE.md`, `NEXT-STEPS`, `SPEC`) y **excluye
  `LEARNINGS.md`** (registra gotchas/estados pasados → menciona patrones malos por diseño; incluirlo da
  falsos positivos — lo confirmamos al implementar). Denylist corta y SÓLIDA (sin negaciones → sin FP; por
  eso NO se chequea "caching").
- **[3] frescura (AVISA):** fecha de "ESTADO ACTUAL (…)" vs `git log -1 --format=%cs`; si el commit va > 7
  días por delante → warning (`date -d` GNU, en Arch local y CI ubuntu).
- **[4] WIP abierto (AVISA):** `grep -cE '^- \[[ ~?]\] ' NEXT-STEPS` > 0 → warning informativo.
- Exit ≠0 solo en [1]/[2]; warnings no bloquean. Wired en `.github/workflows/ci.yml` (tras `pnpm -r test`).

### 3. Hooks (`additionalContext` vía `hookSpecificOutput`, estilo de los hooks existentes)
- **`SessionStart` → `session-start-reconcile.sh`**: emite el ritual de arranque (leer NEXT-STEPS/SPEC/
  LEARNINGS + invariantes + `git status`; docs≠código → manda código). JSON estático, ignora stdin.
- **`UserPromptSubmit` → `wip-reconcile.sh`** (2º hook del array): si hay WIP abierto en NEXT-STEPS,
  inyecta recordatorio de reconciliar antes de cambiar de foco. **Solo emite con WIP abierto** (no ruidoso).
  Gotcha: `open=$(grep -cE … )` + `open=${open:-0}` (NO `|| echo 0`: `grep -c` imprime `0` y sale 1 → duplicaría).
- `.claude/settings.json`: nuevo bloque `SessionStart` + 2º entrada en `UserPromptSubmit`.

## Edge-cases / límites
- Hooks dan **timing**, no corrigen contenido (la integridad semántica es del modelo). check-docs cubre
  solo lo verificable. Denylist deliberadamente mínima para no generar falsos positivos (que erosionan confianza).
- `grep -c` subshell/exit-1 gotcha (arriba). Process-substitution para no perder vars en `while`.

## Verificación
`bash scripts/check-docs.sh` verde en docs reconciliados; probar que CAZA un link roto + patrón scaffold
(luego revertir). Correr los 2 hooks a mano (WIP abierto vs vacío) → JSON correcto / silencio. `settings.json`
y `ci.yml` parsean. Sin `.ts` tocado → suite igual (sanity `pnpm -r test`).
