# Diseño técnico — Contrato de entrada multimodal (audio/voz + imágenes)

> **Altitud:** spec TÉCNICO de bajo nivel (firmas, DDL, edge-cases). El plan de alto nivel (fases,
> secuencia, estrategia de ejecución) vive en [`2026-06-13-multimodal-input-plan.md`](2026-06-13-multimodal-input-plan.md).
> Estado vivo en [`../../NEXT-STEPS.md`](../../NEXT-STEPS.md).

## Problema

El core asume **texto puro** end-to-end: `TurnRequest.userText: string` cableado en `agent.respond`,
persistencia `messages.content`, resumen rodante y traces; y Telegram **descarta** todo lo que no sea
`message.text` (`normalize.ts:60-62`). Bloquea el caso natural (notas de voz/fotos al bot) y deja el
"procesamiento de material" sin base. Primer eje del "próximo paso mayor".

## Decisiones (alcance fijado por Kevin)

- **Multimodal primero** — el harness/registry de acciones + HITL es **otra iteración** (dejar seams).
- **Modalidades: audio/voz + imágenes** (NO PDF/docs — `kind` ampliable a `document` de forma aditiva).
- **Híbrido**: puertos de comprensión de media + parts nativos según capacidad declarada del modelo.
- **Persistencia texto-derivado + referencia** (transcripción/descripción en `content` + metadata, sin binarios).

## Stack verificado (context7 + código)

`ai@6.0.200` + `@openrouter/ai-sdk-provider@2.9.0` (**NO v7**). En `ai@6`:
`UserModelMessage.content = string | Array<TextPart|ImagePart|FilePart>`:
- `ImagePart = { type:"image", image: string|Uint8Array|URL, mediaType? }`
- `FilePart  = { type:"file",  data: string|Uint8Array|URL, mediaType: string, filename? }` (audio nativo = FilePart audio)

Hay `experimental_transcribe`, pero se usa **`generateText` + file part** contra un Gemini Flash (un solo
modelo barato cubre audio+visión; reusa `createModel`/`adapters/openrouter.ts`).

**Constraint load-bearing:** el core recibe un `LanguageModel` **opaco**; OpenRouter capa la cadena de
fallback a **3 modelos server-side** (`openrouter.ts:25`) → el core **no sabe** cuál respondió. ⇒ la
decisión nativo-vs-normalizar **no se sniffea**; se lee de **config declarada**.

## Arquitectura (ports/adapters-lite)

```
canal (adapter)                         core (puro/puertos)                 adapters
─────────────────                       ───────────────────                 ────────
Telegram getFile+download  ─┐
web base64 decode          ─┼─► ResolvedMedia[]  ─► agent.respond(req,ctx,media)
                                (bytes, interno)        │
                                                        ├─ core/modality.buildUserContent()
                                                        │     audio  → Transcriber.transcribe ──► media-openrouter
                                                        │     imagen → MediaUnderstanding.describe ─► (Gemini Flash)
                                                        │     imagen+nativo → FilePart al modelo de chat
                                                        ├─ content: string | ModelMessagePart[]  → streamText
                                                        └─ derivedText → preview + persistencia (texto)
```

**Regla:** I/O (descarga/decodificación, llamada al modelo de media) vive en **adapters**; la **decisión**
y el armado de `content` viven en el **core** (puro, sobre puertos). El contrato wire **no** lleva bytes.

## Firmas y tipos

### `packages/contracts/src/index.ts` (contrato wire — sin bytes)
```ts
export const mediaKindSchema = z.enum(["image", "audio"])
export type MediaKind = z.infer<typeof mediaKindSchema>

export const inputAttachmentSchema = z.object({
  kind: mediaKindSchema,
  mediaType: z.string(),            // MIME exacto p/ AI SDK parts: "image/jpeg", "audio/ogg"
  ref: z.string(),                  // telegram file_id | "web-inline:<uuid>" (puntero persistible)
  caption: z.string().optional(),
})
export type InputAttachment = z.infer<typeof inputAttachmentSchema>

// turnRequestSchema (modificado):
//   userText: z.string().default(""),               // antes .min(1)
//   attachments: z.array(inputAttachmentSchema).default([]),
//   ...  + .refine(d => d.userText.length > 0 || d.attachments.length > 0, "empty turn")

export const webAttachmentSchema = z.object({         // body de /chat (base64 inline, no multipart)
  kind: mediaKindSchema, mediaType: z.string(),
  dataBase64: z.string(), caption: z.string().optional(),
})
// chatBodySchema (modificado): attachments: z.array(webAttachmentSchema).default([])
```
`@vaio/contracts` NO importa `ai` ni transporta binarios (no serializable/persistible).

### `apps/agent/src/ports/media.ts` (NUEVO — interno al agente)
```ts
import type { Locale } from "@vaio/contracts"
export interface ResolvedMedia {            // bytes VIVOS del turno (no se persisten)
  kind: "image" | "audio"; mediaType: string; ref: string; caption?: string; data: Uint8Array
}
export interface Transcriber {
  transcribe(i: { data: Uint8Array; mediaType: string; locale?: Locale }): Promise<string>
}
export interface MediaUnderstanding {
  describe(i: { data: Uint8Array; mediaType: string; caption?: string; locale?: Locale }): Promise<string>
}
```

### `apps/agent/src/core/modality.ts` (NUEVO — PURO, corazón del TDD)
```ts
// Decide por adjunto y arma el content del mensaje user + el texto a persistir.
export interface BuiltUserContent {
  content: string | ModelMessagePart[]   // string si todo terminó en texto (preserva camino actual)
  derivedText: string                    // lo que se persiste/previsualiza ("[voz] …", "[imagen] …")
}
export async function buildUserContent(args: {
  userText: string; media: ResolvedMedia[];
  transcriber: Transcriber | null; understanding: MediaUnderstanding | null;
  nativeImages: boolean; locale: Locale;
}): Promise<BuiltUserContent>
```
- **audio** → `transcriber.transcribe()` → texto; `derivedText += "[voz] " + t`.
- **imagen + !nativeImages** → `understanding.describe()` → texto; `derivedText += "[imagen] " + d`.
- **imagen + nativeImages** → push `{type:"file", mediaType, data}`; `derivedText += caption ?? "[imagen]"`.
- Si todo termina en texto → `content` es **string** (no array) ⇒ prompt-caching y camino actual intactos.
- **Degradación por-adjunto** (try/catch): puerto null / throw → `derivedText += "[audio no procesable]"`
  (resp. imagen) y se continúa; el turno nunca rompe.

### `apps/agent/src/adapters/media-openrouter.ts` (NUEVO)
`createTranscriber(model)` / `createMediaUnderstanding(model)` → `generateText({ model, messages:[{role:"user",
content:[{type:"text",text:ask}, {type:"file",mediaType,data}]}] })`. `ask` ES/EN: transcribir verbatim /
describir conciso para contexto. `model` = `createModel(apiKey, multimodalChain, logger)` (Gemini Flash).

### `apps/agent/src/adapters/telegram/normalize.ts` (modificado, PURO)
`TelegramUpdate.message` gana: `caption?`, `voice?{file_id,mime_type?,duration?,file_size?}`,
`audio?{…}`, `photo?Array<{file_id,file_size?,width,height}>`, `document?{file_id,mime_type?,file_size?,file_name?}`.
```ts
export interface NormalizedAttachment { kind:"image"|"audio"; fileId:string; mediaType:string }
export type NormalizeResult =
  | { kind:"turn"; updateId; chatId; fromId; text:string; attachments:NormalizedAttachment[]; locale; threadId? }
  | { kind:"ignore"; reason:string }
  | { kind:"unsupported"; updateId; chatId; fromId; locale; threadId?; reason:string }
```
Helper puro `extractAttachments(msg)`: `voice`/`audio`→`audio` (mediaType de `mime_type` o `"audio/ogg"`);
`photo[]`→ el de **mayor `file_size`** (fallback `width*height`), `mediaType:"image/jpeg"`; `document`
image/*→imagen, audio/*→audio, **otro mime (pdf/video/…)→`unsupported`**. `text = msg.text ?? msg.caption ?? ""`.
Solo-texto → `turn` con `attachments:[]` (backward-compat). Ni texto ni media → `ignore("no-content")`.

### `apps/agent/src/adapters/telegram/media.ts` (NUEVO — I/O)
```ts
const API = "https://api.telegram.org"
// download(att): 1) POST {API}/bot<token>/getFile {file_id} → file_path (+ file_size)
//               2) GET  {API}/file/bot<token>/<file_path> → arrayBuffer → Uint8Array
// guarda: file_size>MEDIA_MAX_BYTES → null (no descarga); getFile sin file_path → null; fetch !ok → null
// SECRET: el token arma la URL pero NUNCA se loguea (log solo method/status). → ResolvedMedia | null
```

### `apps/agent/src/core/agent.ts` (modificado)
`AgentDeps` += `transcriber?: Transcriber|null`, `mediaUnderstanding?: MediaUnderstanding|null`,
`nativeImages?: boolean`. Firma: `respond(req, ctx, media: ResolvedMedia[] = [])`. Antes de `messages`:
`const { content, derivedText } = await buildUserContent({...})`. El mensaje `user` usa `content`;
`preview()` y `persist` usan `derivedText`. **Summary/compresión/`recent` sin cambios** (texto). Modelo:
parts nativas → modelo de chat (cadena vision si `nativeImages`); texto → modelo de chat normal.

### Persistencia
`apps/agent/src/adapters/db/schema.ts` — `messages` +=
`attachments: jsonb("attachments").$type<StoredAttachment[]>().default([]).notNull()`.
`ports/conversation.ts` — `export interface StoredAttachment { kind:"image"|"audio"; mediaType:string;
ref:string; caption?:string }`; `TurnRecord += userAttachments?: StoredAttachment[]`; opcional
`StoredMessage += attachments?` (UI futura, **no** se re-inyecta al modelo).
`adapters/neon-conversation.ts` — `appendTurn` inserta `attachments` en la fila `user` (`[]` en assistant);
`loadContext`/`pendingSummary` siguen leyendo `content`.
**Migración:** dev `db:push` (branch Neon; default `[]` ⇒ no rompe filas); prod `db:generate` →
`0002_*.sql` (`ALTER TABLE messages ADD COLUMN attachments jsonb DEFAULT '[]' NOT NULL`) vía
`railway.json preDeployCommand` (sin backfill).

### Config / wiring
`config.ts` += `MULTIMODAL_MODELS` (csv, cap 3; default = 1er modelo de `OPENROUTER_MODELS` con warn),
`MULTIMODAL_NATIVE_IMAGES` (bool, default false), `MEDIA_MAX_BYTES` (default 20·1024·1024). Helper
`multimodalChain(env)`. `index.ts` cablea `mediaModel = createModel(key, multimodalChain, logger)` →
`createTranscriber`/`createMediaUnderstanding` → a `createAgent` y `TelegramDeps`; boot log
`{ multimodal: transcriber!==null, nativeImages }`.

### Rutas de entrada
`adapters/telegram/routes.ts` — descargar attachments (`media.download`), rama `unsupported` → mensaje
cortés en locale, pasar `ResolvedMedia[]` a `respond`. `adapters/http/routes.ts` — decodificar
`attachments[].dataBase64`→`Uint8Array` (`ref:"web-inline:<uuid>"`), validar `MEDIA_MAX_BYTES`, mismo
camino; 400 solo si no hay texto NI attachments.

## Edge cases

- Audio largo / archivo > `MEDIA_MAX_BYTES` → no descarga; mensaje cortés; nunca 500.
- Foto sin caption → `text:""`; `derivedText` = descripción o `"[imagen]"`.
- Doc/PDF/video → `unsupported` → respuesta cortés "no soporto ese tipo aún" (no ignore silencioso).
- Token inválido / getFile sin `file_path` / download !ok → `download` null → core degrada el adjunto, sigue.
- Puerto Transcriber/MediaUnderstanding null → adjunto "[no procesable]", turno sigue.
- Mensaje solo-voz (sin texto) → `userText:""` válido por el refine; tras transcribir `userText`=transcripción.
- Backward-compat: solo-texto → `attachments:[]`, `content` string, comportamiento idéntico; migración con
  default `[]` sin backfill.
- Secret: el bot token arma URLs de descarga pero jamás se loguea (test lo verifica).
- Constraint cadena-de-3: transcripción/visión usan `MULTIMODAL_MODELS` (propia); el chat conserva su cadena
  barata/free. El modo nativo (opt-in `MULTIMODAL_NATIVE_IMAGES`) es la única vía que exige chat vision-capaz.

---

## Fase 2 — envs por modalidad + STT dedicado + salida de voz (TTS) (2026-06-13)

Evolución de la MISMA feature (no es otra). El contrato de entrada (arriba) queda; cambia **cómo** se procesa
cada modalidad y se suma el eje de **salida de voz**.

### API de OpenRouter (fuentes verificadas)
**Autoritativa: `https://openrouter.ai/openapi.json`** (parsear con node; la doc web es JS-rendered → 404 en
WebFetch; `GET /api/v1/models` lista **solo texto** → no inferir cobertura de ahí; el README del provider del
AI SDK solo refleja lo que el *package* envuelve, no la plataforma). Endpoints REST OpenAI-compatible (base
`https://openrouter.ai/api/v1`, `Bearer key`):
- `POST /audio/transcriptions` → `{model, input_audio:{data(base64), format}, language}` ⇒ `{text}`.
- `POST /audio/speech` → `{model, input, voice, response_format:"mp3"|"pcm", speed}` ⇒ audio binario.
- `POST /rerank` → `{model, query, documents:string[], top_n}` ⇒ `{results:[{index, relevance_score, document}]}`.
El `@openrouter/ai-sdk-provider` NO expone `transcription()/speech()/reranking()` → se llaman con **`fetch`
directo** → Vaio sigue **single-provider**. Slugs/precios: galería `openrouter.ai/models` (cambian mensual).

### Cambios de diseño
- **Config por modalidad** (`config.ts`): `TRANSCRIBE_MODEL` (STT), `VISION_MODELS` (csv, chat+file-part),
  `SPEECH_MODELS` (cadena TTS `model|voice|format`; voz omitida→"alloy", formato→"mp3"). `MULTIMODAL_MODELS`
  queda como **fallback** de visión/transcripción (back-compat). Helpers `visionChain`/`transcribeModel`/
  `speechChain`. (No hay vars `SPEECH_MODEL/VOICE/FORMAT` sueltas: `SPEECH_MODELS` las subsume.)
- **STT dedicado** (`adapters/media-openrouter.ts`): `createTranscriber(apiKey, baseURL, model)` → `fetch`
  `POST /audio/transcriptions` con `input_audio:{data:base64, format}`. (Visión sigue `generateText`+file-part
  sobre `VISION_MODELS`.) Transcriber y visión dejan de compartir un solo `LanguageModel`.
- **Salida de voz** (eje nuevo, SOLO Telegram por ahora; web `/chat`=stream de texto → diferido):
  - `ports/speech.ts`: `SpeechSynthesizer.synthesize(text, locale?) → { audio: Uint8Array; mediaType } | null`
    (null = degradación → se manda texto).
  - `adapters/speech-openrouter.ts`: `fetch POST /audio/speech` → bytes (mp3). Lanza→null capturado.
  - `core/speech-policy.ts` (PURO): `shouldSpeak({ inboundHadAudio, userText, locale })` = **default TEXTO**;
    voz si `inboundHadAudio` (espejo) **o** `wantsVoiceReply(userText)` (heurística ES/EN: "respondé(me)
    con/en voz", "hablame", "mandame un audio", "/voz"; "in voice", "voice note"). `stripForSpeech(text)` saca
    HTML/markdown/emojis para que el TTS lea limpio.
  - `adapters/telegram/client.ts`: `sendAudio(chatId, bytes, opts)` (multipart/form-data; el `call` JSON-only
    no sirve para subir binario). Telegram `sendAudio` acepta mp3. Token NUNCA en logs.
  - `adapters/telegram/routes.ts`: `TelegramDeps += speech?`; tras `text`, si `shouldSpeak` y hay `speech` →
    `synthesize(stripForSpeech(text))` → `sendAudio` (fallback `sendMessage` si null).
- **Grounding del prompt** (`core/prompt.ts`): bloque de **capacidades de E/S** (recibe voz/imágenes
  transcriptas/descriptas; responde en voz cuando corresponde). Rol/capacidad, **no** hechos de Kevin
  (mantiene voz≠hechos).

### Edge cases (fase 2)
- `SPEECH_MODELS` vacío → `speech` null → siempre texto (sin romper). Toda la cadena falla → null → texto.
- TTS solo si `shouldSpeak`; default texto → cero costo extra en el caso común.
- mp3 vía `sendAudio` (no `sendVoice`, que exige OGG/Opus y OpenRouter da mp3|pcm).
- Token de Telegram y key de OpenRouter jamás en logs (tests lo verifican).

## Rerank — pendiente futuro (diseño decidido, NO implementado)
Con ~29 chunks no aporta (traés 6–8 de 29). **Activar cuando el corpus crezca** (facts fase 2 / más fuentes).
Diseño: puerto `Reranker.rerank(query, docs[], topN)` + adapter `POST /rerank` (OpenRouter) + integración en
`searchMemory`/`MemoryStore`: recuperar un **K ancho** (`RERANK_FETCH_K`) por vectores → `/rerank`
(cross-encoder) → recortar a `k`. Flag `RERANK_ENABLED=false`. Disparador = corpus grande.

## Seams para el futuro (NO implementar acá)

Harness/registry de acciones + side-effect flag + gating por principal + HITL; `kind` → `document`
(aditivo); embeddings multimodales (RAG sigue text-only); persistencia de binarios (hoy solo `ref` →
re-resolución futura sin tocar el contrato); `CapabilityResolver` por-modelo (declarar modalidades sin
tocar el core); ventana por tokens; persona/policy como dato; **TTS en web `/chat`** (stream de texto →
canal de audio); **rerank** (arriba).
