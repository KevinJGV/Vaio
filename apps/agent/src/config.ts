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
  // Base REST de OpenRouter para los endpoints que el provider del AI SDK NO envuelve
  // (/audio/transcriptions, /audio/speech, /rerank). Ver memoria `openrouter-api-surface`.
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),

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

  // Entrada multimodal (audio/voz + imágenes). Modelos POR MODALIDAD (no todos cubren todo; ver
  // openrouter.ai/models, tabs Transcription/Speech/Image — cambian mensual). `MULTIMODAL_MODELS` queda
  // como FALLBACK de visión/transcripción (back-compat con la fase 1).
  MULTIMODAL_MODELS: z.string().optional(),
  // Visión (imagen→texto o nativa): cadena csv de chat con file-part. Vacía → MULTIMODAL_MODELS → 1er chat.
  VISION_MODELS: z.string().optional(),
  // STT dedicado (audio→texto) vía POST /audio/transcriptions. Vacío → MULTIMODAL_MODELS[0] → chat[0].
  TRANSCRIBE_MODEL: z.string().optional(),
  // true → imágenes se pasan NATIVAS al modelo de chat (la cadena de chat DEBE ser vision-capaz).
  // false (default) → se describen a texto con VISION_MODELS (robusto con cualquier cadena de chat).
  MULTIMODAL_NATIVE_IMAGES: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  // Salida de voz (TTS) vía POST /audio/speech. Sin SPEECH_MODEL → Vaio nunca habla (solo texto).
  SPEECH_MODEL: z.string().optional(),
  SPEECH_VOICE: z.string().default("alloy"), // voz provider-specific; verificar en la galería.
  SPEECH_FORMAT: z.enum(["mp3", "pcm"]).default("mp3"),
  // Límite defensivo de tamaño de media (descarga Telegram / base64 web). Default 20MB.
  MEDIA_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(20 * 1024 * 1024),

  // Canal Telegram (todo opcional → si falta algo, el webhook /tg no se monta).
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_ALLOWED_USER_IDS: z.string().optional(), // csv de telegram user ids
  // Id de Telegram de Kevin (owner). Sólo ese id resuelve a `trusted` (perfil pleno/agéntico);
  // cualquier otro = visitante capado (Vaio lo presenta). Sin esto, nadie es owner.
  OWNER_TELEGRAM_ID: z.coerce.number().int().optional(),
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

/** csv → lista (trim, sin vacíos). */
function csv(s: string | undefined): string[] {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
}

/** Cadena multimodal de FALLBACK (back-compat fase 1): `MULTIMODAL_MODELS` o el 1er modelo de chat. */
function multimodalFallback(env: Env): string[] {
  const explicit = csv(env.MULTIMODAL_MODELS)
  if (explicit.length > 0) return explicit
  const firstChat = modelChain(env)[0]
  return firstChat ? [firstChat] : []
}

/** Cadena de VISIÓN (imagen→texto/nativa, chat+file-part). `VISION_MODELS` → fallback multimodal. */
export function visionChain(env: Env): string[] {
  const explicit = csv(env.VISION_MODELS)
  return explicit.length > 0 ? explicit : multimodalFallback(env)
}

/** Modelo de TRANSCRIPCIÓN (STT, /audio/transcriptions). `TRANSCRIBE_MODEL` → fallback multimodal[0]. */
export function transcribeModel(env: Env): string | undefined {
  return env.TRANSCRIBE_MODEL?.trim() || multimodalFallback(env)[0]
}

/** Config de SALIDA de voz (TTS). null si no hay `SPEECH_MODEL` (Vaio solo habla por texto). */
export function speechConfig(
  env: Env
): { model: string; voice: string; format: "mp3" | "pcm" } | null {
  const model = env.SPEECH_MODEL?.trim()
  if (!model) return null
  return { model, voice: env.SPEECH_VOICE, format: env.SPEECH_FORMAT }
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
