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
  // Persistir la traza de cada turno en Postgres (tabla trace_events) si hay DB. ON salvo "false"/"0".
  // El contenido se guarda COMPLETO (DB privada); la redacción LOG_PROMPTS es solo para stdout.
  TRACE_PERSIST: z
    .string()
    .optional()
    .transform((v) => v !== "false" && v !== "0"),

  // Auth del agente (lo valida el middleware; lo conoce solo el proxy del portafolio).
  AGENT_API_KEY: z.string().optional(),

  // OpenRouter (modelo + cadena de fallback).
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODELS: z.string().optional(),
  // Base REST de OpenRouter para los endpoints que el provider del AI SDK NO envuelve
  // (/audio/transcriptions, /audio/speech, /rerank). Ver memoria `openrouter-api-surface`.
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  // App attribution: identifica la app en el dashboard de OpenRouter (sin esto aparece "unknown").
  // appName → header X-Title; appUrl → HTTP-Referer. Aplica al provider del AI SDK Y a las llamadas REST.
  APP_NAME: z.string().default("Vaio"),
  APP_URL: z.string().default("https://vindevsito.dev"),

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

  // Entrada multimodal (audio/voz + imágenes). Cada modalidad su modelo EXPLÍCITO (no todos cubren todo:
  // visión = VLM por chat; STT = modelo en /audio/transcriptions). Vacío = esa modalidad OFF. Verificar
  // slugs en openrouter.ai/models (tabs Image/Transcription — cambian mensual).
  // Visión (imagen→texto o nativa): cadena csv de chat con file-part. Vacía → visión OFF.
  VISION_MODELS: z.string().optional(),
  // STT dedicado (audio→texto) vía POST /audio/transcriptions. Vacío → STT OFF.
  TRANSCRIBE_MODEL: z.string().optional(),
  // true → imágenes se pasan NATIVAS al modelo de chat (la cadena de chat DEBE ser vision-capaz).
  // false (default) → se describen a texto con VISION_MODELS (robusto con cualquier cadena de chat).
  MULTIMODAL_NATIVE_IMAGES: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  // Salida de voz (TTS) vía POST /audio/speech. CADENA de fallback client-side: voz Y formato son
  // POR-MODELO (no portables) → cada entrada lleva `model|voice|format`. Se prueban en orden; la 1ª que
  // devuelve audio gana; si todas fallan → texto. Ej:
  //   SPEECH_MODELS=hexgrad/kokoro-82m|af_bella|mp3,google/gemini-3.1-flash-tts-preview|Zephyr|pcm
  // pcm se envuelve en WAV (Telegram no reproduce pcm crudo). Vacío → Vaio solo habla por texto.
  SPEECH_MODELS: z.string().optional(),
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

/** Atribución de app para OpenRouter (dashboard). appName→X-Title, appUrl→HTTP-Referer. */
export interface Attribution {
  appName: string
  appUrl: string
}
export function attribution(env: Env): Attribution {
  return { appName: env.APP_NAME, appUrl: env.APP_URL }
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

/** Cadena de VISIÓN (imagen→texto/nativa, chat+file-part). `VISION_MODELS` explícito o vacío → visión OFF. */
export function visionChain(env: Env): string[] {
  return csv(env.VISION_MODELS)
}

/** Modelo de TRANSCRIPCIÓN (STT, /audio/transcriptions). `TRANSCRIBE_MODEL` explícito o undefined → STT OFF. */
export function transcribeModel(env: Env): string | undefined {
  return env.TRANSCRIBE_MODEL?.trim() || undefined
}

export interface SpeechEntry {
  model: string
  voice: string
  format: "mp3" | "pcm"
}

/** Cadena de SALIDA de voz (TTS), fallback client-side. Cada entrada `model|voice|format` (voz y formato
 *  son por-modelo, no portables). Voz omitida → "alloy"; formato omitido/ inválido → "mp3". Lista vacía →
 *  Vaio solo responde por texto. */
export function speechChain(env: Env): SpeechEntry[] {
  return csv(env.SPEECH_MODELS)
    .map((spec) => {
      const [model, voice, format] = spec.split("|").map((p) => p.trim())
      if (!model) return null
      return {
        model,
        voice: voice || "alloy",
        format: format === "pcm" ? "pcm" : "mp3",
      } satisfies SpeechEntry
    })
    .filter((e): e is SpeechEntry => e !== null)
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
