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
  echo "❌ BLOQUEADO por typecheck.sh (hook PostToolUse Edit|Write .ts)" >&2
  echo "QUÉ: tsc --noEmit falló con errores de tipo después de editar un archivo .ts." >&2
  echo "POR QUÉ: la edición introdujo un error de tipo (tipo incorrecto, import faltante, propiedad inexistente, etc.). Invariante #7: evidencia antes de done." >&2
  echo "FIX: leé los errores de tsc abajo, corregí el tipo en el archivo editado, re-ejecutá 'pnpm typecheck' hasta que pase limpio, luego reintentá la edición." >&2
  echo "NO INTENTES: ignorar el error y seguir, agregar @ts-ignore/as any para silenciarlo, o commitear con typecheck roto." >&2
  echo "--- salida de tsc ---" >&2
  echo "$out" >&2
  exit 2   # bloquea y devuelve el feedback al modelo
fi
exit 0
