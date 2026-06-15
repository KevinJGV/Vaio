// Validación de entorno con zod: parsea y tipa process.env al arrancar (fail-fast ante
// valores inválidos). Las claves de servicios son OPCIONALES a propósito: el server debe
// bootear y servir /health aunque falten; la degradación la maneja el wiring (index.ts).

import "./load-env.js"
import { z } from "zod"

/** Entero positivo con default que TOLERA string vacío. `z.coerce.number()` convierte "" → 0 (y `.default()`
 *  solo aplica a `undefined`, no a ""), así que una var presente-pero-vacía en `.env` rompería `.positive()`.
 *  El preprocess mapea "" → undefined para que caiga al default. */
function positiveIntWithDefault(def: number) {
  return z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().positive().default(def)
  )
}

/** Float positivo con default, tolerante a string vacío (mismo patrón que positiveIntWithDefault, sin `.int()`).
 *  Para umbrales fraccionarios (p.ej. distancia coseno). */
function positiveFloatWithDefault(def: number) {
  return z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().positive().default(def)
  )
}

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
  // UN solo modelo a propósito (NO cadena/fallback): la query debe embeberse con el MISMO modelo que indexó
  // los documentos; mezclar modelos da vectores incompatibles (la distancia coseno pierde sentido). Cambiarlo
  // exige reingestar todo (`pnpm ingest`). Por eso no lleva fallback como los demás env de modelos.
  EMBEDDINGS_MODEL: z.string().default("google/gemini-embedding-2"),
  EMBEDDINGS_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),

  // Zona horaria de Kevin para el "sentido del ahora" (fecha/hora inyectada al prompt). IANA TZ.
  OWNER_TIMEZONE: z.string().default("America/Bogota"),

  // Ingesta.
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_USER: z.string().default("KevinJGV"),
  LASTFM_API_KEY: z.string().optional(),
  LASTFM_USER: z.string().optional(),

  // Conector WakaTime (tiempo de programación medido). Opcional → sin key, el conector no corre.
  WAKATIME_API_KEY: z.string().optional(),
  // Conector Steam (qué juega / juegos favoritos). Requiere ambas. SteamID64 (perfil de juegos público).
  STEAM_API_KEY: z.string().optional(),
  STEAM_ID: z.string().optional(),

  // "Vaio se nutre solo" (pasos 1+2): ingesta de fuentes CRUDAS (md + código) de repos curados, incl. el
  // propio repo (self-awareness). csv de "owner/repo[@branch]" (branch omitido → default branch del repo).
  // Vacío/ausente → la fuente no corre (degrada limpio). Reusa GITHUB_TOKEN.
  RAW_SOURCE_REPOS: z.string().optional(),
  // Cap defensivo de tamaño por archivo crudo (default 100KB). Más grande ≈ generado/datos → se descarta.
  RAW_FILE_MAX_BYTES: positiveIntWithDefault(100 * 1024),
  // Cap de chunks por repo (corta runaway de embeddings; los descartes se LOGUEAN, no se truncan en silencio).
  RAW_REPO_MAX_CHUNKS: positiveIntWithDefault(800),

  // Memoria conversacional.
  SUMMARY_MODELS: z.string().optional(), // modelo barato del resumen; default = cola de la cadena.
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
  TRANSCRIBE_MODELS: z.string().optional(),
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
  // Rerank (2ª etapa del RAG): csv de fallback client-side. Vacío → OFF (cae a vector top-K).
  RERANK_MODELS: z.string().optional(),
  // Pool de candidatos (wide-K) que se recupera por vector y se manda a rerankear. Default 30.
  RERANK_CANDIDATES: positiveIntWithDefault(30),
  // Sync incremental de repos: umbral de archivos cambiados para hacerlo INLINE en el chat; más → background. Default 20.
  SYNC_INLINE_MAX_FILES: positiveIntWithDefault(20),
  // Freshness gate: TTL (minutos) — no rechequea la frescura de un repo si lo hizo hace menos. Default 10.
  FRESHNESS_TTL_MINUTES: positiveIntWithDefault(10),
  // Fuerza re-index FULL en `sync.ts` (clearSource + re-embeber todo) ignorando frescura. Para re-index puntual
  // (cambio de chunker/policy, o poblar archivos que un cap bajo dejó afuera). ON con "true"/"1".
  SYNC_FORCE_FULL: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
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

  // Adjudicación de conflictos de facts: al PROPONER un hecho, se buscan facts confirmados cercanos para que
  // Vaio decida si el nuevo reemplaza a uno viejo. DISTANCE = distancia coseno máx para considerar "cercano"
  // (generoso a propósito: el modelo + el owner filtran la contradicción real; el umbral solo corta ruido lejano).
  // CANDIDATES = cuántos candidatos sugerir como máx.
  FACT_CONFLICT_DISTANCE: positiveFloatWithDefault(0.45),
  FACT_CONFLICT_CANDIDATES: positiveIntWithDefault(3),
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

/** Cadena de TRANSCRIPCIÓN (STT, /audio/transcriptions). `TRANSCRIBE_MODELS` = csv → fallback CLIENT-SIDE:
 *  el endpoint es single-model (no tiene el fallback server-side de OpenRouter que sí tiene el chat), así que
 *  el adapter prueba cada modelo en orden hasta que uno transcriba. Vacía → STT OFF. */
export function transcribeChain(env: Env): string[] {
  return csv(env.TRANSCRIBE_MODELS)
}

/** Cadena del RESUMEN (chat). `SUMMARY_MODELS` = csv → fallback server-side (createModel). Vacía → el llamador
 *  cae a la cola de la cadena de chat (modelo barato de respaldo). */
export function summaryChain(env: Env): string[] {
  return csv(env.SUMMARY_MODELS)
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

/** Cadena de RERANK (fallback client-side, /rerank single-model REST). Vacía → rerank OFF (vector top-K). */
export function rerankChain(env: Env): string[] {
  return csv(env.RERANK_MODELS)
}

/** Spec de un repo a ingerir como fuente cruda (parseado de RAW_SOURCE_REPOS). */
export interface RawRepoSpec {
  owner: string
  repo: string
  branch?: string
}

/** RAW_SOURCE_REPOS (csv "owner/repo[@branch]") → lista de specs. Descarta entradas malformadas
 *  (sin "owner/repo"). Vacío/ausente → []. Puro/testeable (mismo estilo que speechChain). */
export function rawSourceRepos(env: Env): RawRepoSpec[] {
  return csv(env.RAW_SOURCE_REPOS)
    .map((entry) => {
      const [slug, branch] = entry.split("@").map((p) => p.trim())
      const [owner, repo] = (slug ?? "").split("/").map((p) => p.trim())
      if (!owner || !repo) return null
      return {
        owner,
        repo,
        ...(branch ? { branch } : {}),
      } satisfies RawRepoSpec
    })
    .filter((s): s is RawRepoSpec => s !== null)
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
