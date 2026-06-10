#!/usr/bin/env bash
# PreToolUse (Bash, filtrado a git * vía `if`): bloquea commitear/agregar el .env REAL
# (contiene secrets). .env.example está permitido. Defensa extra al .gitignore.
set -uo pipefail
proj="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

cmd=$(python3 -c "import sys,json
try: print((json.load(sys.stdin).get('tool_input') or {}).get('command',''))
except Exception: print('')" 2>/dev/null)

# Saca .env.example del análisis (es seguro). Lo que quede como .env es el real.
probe=$(printf '%s' "$cmd" | sed 's/\.env\.example//g')

blocked=0
# (a) el comando hace `git add`/`git commit` y referencia un .env real (incluye -f)
if printf '%s' "$probe" | grep -qE 'git +(add|commit)' \
   && printf '%s' "$probe" | grep -qE '(^|[^A-Za-z0-9_/.])\.env([^A-Za-z0-9_]|$)'; then
  blocked=1
fi
# (b) el .env real ya está en el stage
if [ -d "$proj/.git" ] && (cd "$proj" && git diff --cached --name-only 2>/dev/null | grep -qx '.env'); then
  blocked=1
fi

if [ "$blocked" = 1 ]; then
  echo "🚫 BLOQUEADO: el .env real tiene secrets y NO debe commitearse (usá .env.example)." >&2
  echo "   Si quedó en stage: git restore --staged .env" >&2
  exit 2
fi
exit 0
