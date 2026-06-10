#!/usr/bin/env bash
# UserPromptSubmit: si el prompt menciona las libs de Vaio, inyecta (additionalContext)
# el recordatorio de consultar context7 antes de codear. Análogo al hook del portafolio.
set -uo pipefail

prompt=$(python3 -c "import sys,json
try: print(json.load(sys.stdin).get('prompt',''))
except Exception: print('')" 2>/dev/null)

if printf '%s' "$prompt" | grep -qiE 'vercel ai|ai[- ]sdk|@ai-sdk|streamtext|generatetext|\bhono\b|openrouter|pgvector|\bneon\b|postgres|embedding'; then
  python3 - <<'PY'
import json
msg = ("Recordatorio (CLAUDE.md): vas a tocar APIs de librerías (Vercel AI SDK / Hono / "
       "OpenRouter / pgvector). Consultá context7 (resolve-library-id + query-docs) ANTES "
       "de codear — no confíes en memoria de entrenamiento; el catálogo y precios de modelos "
       "cambian y están más allá del corte. Verificá modelos en openrouter.ai/models.")
print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": msg}}))
PY
fi
exit 0
