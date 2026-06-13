#!/usr/bin/env bash
# UserPromptSubmit: si docs/NEXT-STEPS.md tiene WIP ABIERTO ([ ]/[~]/[?]) en "🚧 En proceso/verificación",
# recuerda reconciliar su estado ANTES de cambiar de foco. Solo emite cuando hay WIP abierto → no es ruidoso.
# Justo el momento del caso "listo, en prod; ahora [siguiente]" (ese "ahora" es un prompt nuevo).
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
NS="$ROOT/docs/NEXT-STEPS.md"
[ -f "$NS" ] || exit 0

open=$(grep -cE '^- \[[ ~?]\] ' "$NS" 2>/dev/null)
open=${open:-0}
if [ "$open" -gt 0 ]; then
  python3 - "$open" <<'PY'
import json, sys
n = sys.argv[1]
msg = (f"[ritual Vaio] Hay {n} ítem(s) WIP abiertos en docs/NEXT-STEPS.md ('🚧 En proceso/verificación'). "
       "Si vas a cambiar de foco o dar trabajo por cerrado, PRIMERO reconciliá su estado real "
       "([x] completado / [~] parcial / [?] pendiente-verificación), surface lo que quede abierto y mové lo "
       "cerrado al Historial. No dejes nada suelto ni arrastres deuda documental.")
print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": msg}}))
PY
fi
exit 0
