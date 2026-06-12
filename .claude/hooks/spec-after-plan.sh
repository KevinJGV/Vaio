#!/usr/bin/env bash
# PostToolUse(ExitPlanMode): al salir de plan mode con un plan aprobado, recuerda de forma
# OBLIGATORIA escribir el trabajo en el proyecto como DOS artefactos (docs/superpowers/specs/:
# <tema>-design.md técnico + <tema>-plan.md de alto nivel con "Estrategia de ejecución"), en vez
# de dejarlo solo en el plan file efímero de plan mode. Disparo determinístico (lo corre el harness);
# la acción (escribir los archivos) sigue siendo del modelo. Ver CLAUDE.md → "… Planes durables".
#
# Inyecta el recordatorio en el contexto del modelo vía hookSpecificOutput.additionalContext.
# Ignora stdin (el plan llega ahí, pero no lo necesitamos). Solo emite JSON por stdout.

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"[spec-driven · OBLIGATORIO] Saliste de plan mode con un plan aprobado. DEBE quedar escrito en el proyecto (no opcional) como DOS artefactos en docs/superpowers/specs/ con el mismo YYYY-MM-DD-<tema>: (1) <tema>-design.md = spec TÉCNICO de bajo nivel (arquitectura, firmas, DDL, edge-cases); (2) <tema>-plan.md = plan de ALTO NIVEL (fases, entregables, secuencia, dependencias) + sección obligatoria 'Estrategia de ejecución' (evaluá subagentes vs orquestador-directo por tamaño/complejidad). Promové lo aprobado a AMBOS según su altitud (no dupliques contenido entre ellos), ANTES o JUNTO con implementar. NO lo dejes solo en el plan file efímero (~/.claude/plans) ni en docs/SPEC.md (solo norte/fundacional). Reconciliá NEXT-STEPS.md. Única excepción: cambio realmente trivial de 1-2 líneas."}}
JSON
