#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): tras editar un .ts, corre `npm run typecheck`
# (tsc --noEmit) y BLOQUEA con feedback si falla. Análogo al `astro check` del portafolio.
# Salta limpio si el archivo no es .ts o si aún no hay node_modules (antes de npm install).
set -uo pipefail
proj="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

file=$(python3 -c "import sys,json
try: print((json.load(sys.stdin).get('tool_input') or {}).get('file_path',''))
except Exception: print('')" 2>/dev/null)

case "$file" in
  *.ts) ;;            # seguir
  *) exit 0 ;;        # no es TS → nada
esac

cd "$proj" 2>/dev/null || exit 0
[ -d node_modules ] || exit 0   # sin deps todavía → saltar limpio

if ! out=$(npm run --silent typecheck 2>&1); then
  echo "❌ typecheck (tsc) falló — corregí los errores de tipo antes de seguir:" >&2
  echo "$out" >&2
  exit 2   # bloquea y devuelve el feedback al modelo
fi
exit 0
