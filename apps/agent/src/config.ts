// Validación de entorno con zod: parsea y tipa process.env al arrancar (fail-fast ante
// valores inválidos). Las claves de servicios son OPCIONALES a propósito: el server debe
// bootear y servir /health aunque falten; la degradación la maneja el wiring (index.ts).

import "./load-env.js"
import { z } from "zod"

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),

  // Entorno + observabilidad (logs estructurados a stdout — los captura Railway).
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "silent"])
    .default("info"),
  // pretty (dev) | json (prod) | auto (pretty salvo en producción).
  LOG_FORMAT: z.enum(["pretty", "json", "auto"]).default("auto"),
  // Loguear contenido crudo (prompts del usuario, args/output de tools, reasoning completo).
  // OFF por defecto (privacidad/inyección). Acepta "true"/"1"; cualquier otra cosa = false.
  LOG_PROMPTS: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  // Auth del agente (lo valida el middleware; lo conoce solo el proxy del portafolio).
  AGENT_API_KEY: z.string().optional(),

  // OpenRouter (modelo + cadena de fallback).
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODELS: z.string().optional(),

  // Memoria (Neon + embeddings).
  DATABASE_URL: z.string().optional(),
  EMBEDDINGS_API_KEY: z.string().optional(),
  // Embeddings vía OpenRouter (mismo provider que el chat). Verificar slug en openrouter.ai/models.
  EMBEDDINGS_MODEL: z.string().default("google/gemini-embedding-2"),
  EMBEDDINGS_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),

  // Ingesta.
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_USER: z.string().default("KevinJGV"),
  LASTFM_API_KEY: z.string().optional(),
  LASTFM_USER: z.string().optional(),

  // Memoria conversacional.
  SUMMARY_MODEL: z.string().optional(), // modelo barato del resumen; default = cola de la cadena.
  SUMMARY_THRESHOLD: z.coerce.number().int().positive().default(12),
  CONVERSATION_RECENT_LIMIT: z.coerce.number().int().positive().default(10),

  // Compresión de contexto (Tier 1, determinístico — @vaio/compress). ON salvo "false"/"0".
  COMPRESS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== "false" && v !== "0"),
  COMPRESS_INTENSITY_CONV: z.enum(["lite", "full", "ultra"]).default("lite"),
  COMPRESS_INTENSITY_RAG: z.enum(["lite", "full", "ultra"]).default("full"),

  // Canal Telegram (todo opcional → si falta algo, el webhook /tg no se monta).
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_ALLOWED_USER_IDS: z.string().optional(), // csv de telegram user ids
})

export type Env = z.infer<typeof envSchema>

/** Parsea y valida el entorno. Lanza si hay valores con tipo inválido. */
export function loadConfig(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error(
      "[config] Entorno inválido:",
      JSON.stringify(parsed.error.flatten().fieldErrors)
    )
    throw new Error("Configuración de entorno inválida.")
  }
  return parsed.data
}

/** Cadena de fallback de modelos (primario → fallback → free), desde OPENROUTER_MODELS. */
export function modelChain(env: Env): string[] {
  return (env.OPENROUTER_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Telegram user ids permitidos (csv → Set<number>, descarta vacíos y no-numéricos). */
export function telegramAllowedIds(env: Env): Set<number> {
  const ids = (env.TELEGRAM_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) // sin esto, Number("") === 0 metería un id espurio
    .map(Number)
    .filter((n) => Number.isInteger(n))
  return new Set(ids)
}

/**
 * El canal Telegram se habilita con token + secret. El allowlist es OPCIONAL: vacío = acceso
 * abierto (el gating queda en la config del propio bot); con ids = whitelist estricta por user.
 */
export function telegramEnabled(env: Env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET)
}
