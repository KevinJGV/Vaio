#!/usr/bin/env bash
# PostToolUse(ExitPlanMode): al salir de plan mode con un plan aprobado, recuerda de forma
# OBLIGATORIA escribir el plan en el proyecto (docs/superpowers/specs/) en vez de dejarlo solo
# en el plan file efímero de plan mode. Disparo determinístico (lo corre el harness); la acción
# (escribir el archivo) sigue siendo del modelo. Ver CLAUDE.md → "Metodología … Planes durables".
#
# Inyecta el recordatorio en el contexto del modelo vía hookSpecificOutput.additionalContext.
# Ignora stdin (el plan llega ahí, pero no lo necesitamos). Solo emite JSON por stdout.

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"[spec-driven · OBLIGATORIO] Saliste de plan mode con un plan aprobado. El plan DEBE quedar escrito en el proyecto, no es opcional: PROMOVÉ el plan aprobado a docs/superpowers/specs/YYYY-MM-DD-<tema>.md (un archivo por feature) ANTES o JUNTO con implementar. NO lo dejes solo en el plan file efímero (~/.claude/plans) y NO lo metas en docs/SPEC.md (eso es solo norte/fundacional). Reconciliá NEXT-STEPS.md. Única excepción: un cambio realmente trivial de 1-2 líneas."}}
JSON
