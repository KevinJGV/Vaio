// Núcleo PURO de la entrada multimodal: dado el texto del usuario + los adjuntos YA resueltos a bytes
// (`ResolvedMedia[]`, los baja el adapter de canal) + los puertos de comprensión, decide por adjunto
// si NORMALIZAR a texto (transcribir audio / describir imagen) o pasar PARTS NATIVOS al modelo, y
// devuelve el `content` del mensaje user (string si todo terminó en texto → preserva el camino actual
// y el prompt-caching) más el `derivedText` que se persiste/previsualiza. Sin I/O directo: las llamadas
// a transcripción/visión van por los puertos inyectados. Degradación por-adjunto (invariante "siempre
// responde"): si un puerto es null o lanza, se inserta un marcador y el turno sigue.

import type { Locale } from "@vaio/contracts"
import type { FilePart, UserContent } from "ai"
import type {
  MediaUnderstanding,
  ResolvedMedia,
  Transcriber,
} from "../ports/media.js"
import type { DegradeReport } from "./observability.js"
import { errMsg } from "./util.js"

export interface BuiltUserContent {
  /** Lo que se manda al modelo: string si todo terminó en texto, o parts si hay media nativa. */
  content: UserContent
  /** Lo que se persiste/previsualiza (texto plano con marcadores [voz]/[imagen]). */
  derivedText: string
}

interface Markers {
  voice: string
  image: string
  audioFail: string
  imageFail: string
}

function markersFor(locale: Locale): Markers {
  return locale === "en"
    ? {
        voice: "[voice]",
        image: "[image]",
        audioFail: "[audio not processable]",
        imageFail: "[image not processable]",
      }
    : {
        voice: "[voz]",
        image: "[imagen]",
        audioFail: "[audio no procesable]",
        imageFail: "[imagen no procesable]",
      }
}

export async function buildUserContent(args: {
  userText: string
  media: ResolvedMedia[]
  transcriber: Transcriber | null
  understanding: MediaUnderstanding | null
  nativeImages: boolean
  locale: Locale
  /** Reporta una degradación por-adjunto (transcribe/visión falló). El wiring (agent.ts) lo conecta a
   *  log + TraceEvent; ausente (p.ej. tests) → degrada sin reportar. */
  onDegrade?: (d: DegradeReport) => void
}): Promise<BuiltUserContent> {
  const {
    userText,
    media,
    transcriber,
    understanding,
    nativeImages,
    locale,
    onDegrade,
  } = args
  const m = markersFor(locale)

  // `pieces` alimenta TANTO el texto del modelo COMO el texto persistido (son idénticos: el modelo
  // se beneficia de saber que algo vino de una voz/imagen, y la persistencia queda legible).
  const pieces: string[] = []
  if (userText.trim().length > 0) pieces.push(userText.trim())
  const fileParts: FilePart[] = []

  for (const item of media) {
    if (item.kind === "audio") {
      const text = await safe("transcribe", onDegrade, () =>
        transcriber?.transcribe({
          data: item.data,
          mediaType: item.mediaType,
          locale,
        })
      )
      pieces.push(text ? `${m.voice} ${text}` : m.audioFail)
      continue
    }
    // imagen
    if (nativeImages) {
      fileParts.push({
        type: "file",
        data: item.data,
        mediaType: item.mediaType,
      })
      pieces.push(item.caption ? `${m.image} ${item.caption}` : m.image)
      continue
    }
    const desc = await safe("vision", onDegrade, () =>
      understanding?.describe({
        data: item.data,
        mediaType: item.mediaType,
        caption: item.caption,
        locale,
      })
    )
    pieces.push(desc ? `${m.image} ${desc}` : m.imageFail)
  }

  const text = pieces.join(" ").trim()
  if (fileParts.length > 0) {
    const content: UserContent = []
    if (text.length > 0) content.push({ type: "text", text })
    content.push(...fileParts)
    return { content, derivedText: text }
  }
  return { content: text, derivedText: text }
}

/**
 * Ejecuta una llamada opcional a un puerto. Devuelve null si el puerto no existe (off por config → NO se
 * reporta degradación) o si LANZA (fallo real → se reporta vía onDegrade con la causa, antes de degradar).
 */
async function safe(
  component: string,
  onDegrade: ((d: DegradeReport) => void) | undefined,
  fn: () => Promise<string> | undefined
): Promise<string | null> {
  try {
    const r = await fn()
    return r && r.trim().length > 0 ? r.trim() : null
  } catch (err) {
    onDegrade?.({
      component,
      reason: `${component} falló`,
      detail: errMsg(err),
    })
    return null
  }
}
