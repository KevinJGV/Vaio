#!/usr/bin/env bash
# SessionStart: inyecta el ritual de arranque (reconciliar docs ↔ estado real) como additionalContext.
# Determinístico en el TIMING; la acción (leer/reconciliar) sigue siendo del modelo. Ver CLAUDE.md →
# "Al empezar la sesión — RITUAL OBLIGATORIO" + "Integridad documental". Ignora stdin; solo emite JSON.
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"[ritual Vaio] Antes de actuar: leé docs/NEXT-STEPS.md (ESTADO ACTUAL = fuente de verdad viva + la lista '🚧 En proceso/verificación'), docs/SPEC.md (norte), docs/LEARNINGS.md y los Invariantes de CLAUDE.md; mirá git status/log. Regla anti-drift: si los docs contradicen el código/git, MANDA el código → reconciliá los docs ANTES de construir. Si hay WIP abierto sin cerrar, reconcilialo antes de cambiar de foco."}}
JSON
