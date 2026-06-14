// Detección PURA de secrets (SEGURIDAD CRÍTICA). Escanea texto en busca de patrones de
// credenciales (claves AWS/GitHub/Slack/Stripe/OpenRouter/OpenAI, private keys, URLs de
// Postgres con password, JWTs y asignaciones genéricas `secret/token/password = "…"`).
//
// POLÍTICA: este módulo SOLO DETECTA. El llamador hace SKIP del archivo entero si
// `hasSecret` → true (NO redacta). Diseñado alto-recall: preferimos un falso positivo
// ocasional (saltar un archivo limpio) antes que ingerir una credencial real.
//
// Anti-falsos-positivos: el matcher genérico exige un literal entre comillas de 8+ chars
// (un `KEY=` vacío o una referencia `process.env.X` no disparan) e ignora placeholders
// conocidos (your-, changeme, xxx, placeholder, example, …).

export interface SecretFinding {
  pattern: string
  line: number
}

/** Placeholders típicos de docs/.env.example: si el valor entre comillas es claramente
 *  un marcador, el matcher genérico lo ignora (evita falsos positivos). */
const PLACEHOLDER_DENYLIST = [
  "your-",
  "your_",
  "yourkey",
  "changeme",
  "change-me",
  "placeholder",
  "example",
  "dummy",
  "sample",
  "test-value",
  "<",
  "...",
]

/** ¿El valor capturado por el matcher genérico es un placeholder (no un secret real)? */
function isPlaceholder(value: string): boolean {
  const v = value.toLowerCase()
  // "xxx", "xxxx", … (solo equis) son placeholders aunque tengan 8+ chars.
  if (/^x+$/.test(v)) return true
  return PLACEHOLDER_DENYLIST.some((needle) => v.includes(needle))
}

// Cada patrón con nombre corto. Orden = prioridad de reporte por línea: los específicos
// (Stripe/OpenRouter) van ANTES que el genérico `sk-…` para no etiquetar mal.
interface PatternDef {
  name: string
  re: RegExp
  /** Hook opcional para descartar el match (p.ej. placeholders del genérico). */
  reject?: (match: RegExpExecArray) => boolean
}

const PATTERNS: PatternDef[] = [
  { name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ },
  {
    name: "private-key",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  { name: "github-pat", re: /ghp_[A-Za-z0-9]{36}/ },
  { name: "slack-token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "stripe-secret", re: /sk_(?:live|test)_[0-9a-zA-Z]{24,}/ },
  { name: "openrouter-key", re: /sk-or-v1-[a-f0-9]{16,}/ },
  // OpenAI-style: `sk-` + 20+ alfanum. Excluye los que ya capturan Stripe (`sk_…`, distinto
  // separador) y OpenRouter (`sk-or-v1-…`) con un negative-lookahead; el `-` tras `sk` evita
  // matchear hostnames tipo `sk-website` (eso requeriría 20 chars contiguos sin `.`/`/`).
  { name: "openai-key", re: /sk-(?!or-v1-)[A-Za-z0-9]{20,}/ },
  { name: "postgres-url", re: /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/ },
  {
    name: "jwt",
    re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/,
  },
  {
    name: "generic-assignment",
    re: /(?:secret|api[_-]?key|token|password|passwd|bearer)\s*[:=]\s*['"]([^'"]{8,})['"]/i,
    reject: (m) => isPlaceholder(m[1] ?? ""),
  },
]

/** Busca patrones de secret en el contenido. Devuelve hallazgos ([] = limpio). `line` es 1-based. */
export function scanSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    for (const { name, re, reject } of PATTERNS) {
      // RegExp sin flag global: exec parte de cero, sin estado entre líneas.
      const match = re.exec(line)
      if (match && !(reject?.(match) ?? false)) {
        findings.push({ pattern: name, line: i + 1 })
      }
    }
  }
  return findings
}

/** ¿Tiene algún secret? (conveniencia sobre scanSecrets). */
export function hasSecret(content: string): boolean {
  return scanSecrets(content).length > 0
}
