#!/usr/bin/env bash
# Red automática anti-drift de docs — SUBCONJUNTO VERIFICABLE (no es un linter semántico).
# Corre en CI (.github/workflows/ci.yml) y a mano. FALLA (exit≠0) ante contradicciones inequívocas /
# links rotos; AVISA (warning, no bloquea) ante heurísticas de staleness.
# Límite honesto: NO valida si "el próximo paso es correcto" ni si la prosa refleja la intención —
# eso necesita criterio (ver CLAUDE.md → "Integridad documental"). Esto es la red fina, no la cura.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail=0

echo "check-docs: integridad de docs (anti-drift)"

# [1/4] Cross-links de specs rotos (FALLA): rutas superpowers/specs/*.md referenciadas que no existen.
echo "[1/4] cross-links de specs…"
broken=""
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  [ -f "docs/$ref" ] || broken="$broken docs/$ref"
done < <(grep -hoE 'superpowers/specs/[A-Za-z0-9._-]+\.md' docs/*.md 2>/dev/null | sort -u)
if [ -n "$broken" ]; then
  for b in $broken; do printf '  ❌ spec link roto: %s\n' "$b"; done
  fail=1
else
  echo "  ✓ ok"
fi

# [2/4] Contradicción inequívoca (FALLA): "Fase 1 en scaffold" mientras el core ya existe.
# Escanea SOLO los docs que afirman estado actual; EXCLUYE LEARNINGS.md (su trabajo es registrar
# gotchas/estados pasados → menciona patrones malos por diseño; incluirlo daría falsos positivos).
echo "[2/4] contradicciones conocidas…"
contradiction=0
if [ -f apps/agent/src/core/agent.ts ]; then
  if grep -riE 'fase 1.{0,40}scaffold|scaffold.{0,40}fase 1' CLAUDE.md docs/NEXT-STEPS.md docs/SPEC.md >/dev/null 2>&1; then
    printf '  ❌ doc dice "Fase 1 en scaffold" pero apps/agent/src/core/agent.ts existe (Fase 1 hecha)\n'
    fail=1; contradiction=1
  fi
fi
[ "$contradiction" -eq 0 ] && echo "  ✓ ok"

# [3/4] Frescura del bloque ESTADO ACTUAL en NEXT-STEPS (AVISA).
echo "[3/4] frescura de 'ESTADO ACTUAL'…"
estado_date=$(grep -oE 'ESTADO ACTUAL \(([0-9]{4}-[0-9]{2}-[0-9]{2})' docs/NEXT-STEPS.md 2>/dev/null \
  | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
last_commit_date=$(git log -1 --format=%cs 2>/dev/null || echo "")
if [ -z "$estado_date" ]; then
  printf '  ⚠️  no encontré "ESTADO ACTUAL (YYYY-MM-DD)" en docs/NEXT-STEPS.md\n'
elif [ -n "$last_commit_date" ]; then
  ed=$(date -d "$estado_date" +%s 2>/dev/null || echo 0)
  cd_=$(date -d "$last_commit_date" +%s 2>/dev/null || echo 0)
  if [ "$ed" -gt 0 ] && [ "$cd_" -gt 0 ]; then
    diff=$(( (cd_ - ed) / 86400 ))
    if [ "$diff" -gt 7 ]; then
      printf '  ⚠️  ESTADO ACTUAL (%s) quedó %s días detrás del último commit (%s) → ¿reconciliar?\n' \
        "$estado_date" "$diff" "$last_commit_date"
    else
      echo "  ✓ ok ($estado_date)"
    fi
  fi
fi

# [4/4] WIP abierto en "🚧 En proceso / verificación" (AVISA — informativo).
echo "[4/4] WIP abierto…"
open_wip=$(grep -cE '^- \[[ ~?]\] ' docs/NEXT-STEPS.md 2>/dev/null)
open_wip=${open_wip:-0}
if [ "$open_wip" -gt 0 ]; then
  printf '  ⚠️  %s ítem(s) WIP abiertos en NEXT-STEPS (pendiente de cerrar/verificar)\n' "$open_wip"
else
  echo "  ✓ sin WIP abierto"
fi

echo "----"
if [ "$fail" -ne 0 ]; then
  echo "check-docs: ❌ FALLÓ (corregí las contradicciones/links de arriba)"
  exit 1
fi
echo "check-docs: ✓ OK (warnings no bloquean)"
exit 0
