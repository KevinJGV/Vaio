// Descarga de media de Telegram (adapter I/O — fuera del core). Dos pasos de la Bot API:
//   1) getFile(file_id) → file_path
//   2) GET https://api.telegram.org/file/bot<token>/<file_path> → bytes
// Devuelve `ResolvedMedia` (bytes vivos) o null si falla / excede el límite — el caller degrada.
// SECRET: el bot token arma las URLs pero NUNCA se loguea (solo se loguea kind/status).

import type { Logger } from "../../ports/logger.js"
import type { ResolvedMedia } from "../../ports/media.js"
import type { NormalizedAttachment } from "./normalize.js"

const API = "https://api.telegram.org"

export interface TelegramMedia {
  download(att: NormalizedAttachment): Promise<ResolvedMedia | null>
}

export function createTelegramMedia(
  botToken: string,
  logger: Logger,
  maxBytes: number
): TelegramMedia {
  return {
    async download(att) {
      try {
        // 1) getFile → file_path (+ file_size).
        const metaRes = await fetch(`${API}/bot${botToken}/getFile`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file_id: att.fileId }),
        })
        if (!metaRes.ok) {
          logger.warn(
            { kind: att.kind, status: metaRes.status },
            "getFile no-2xx"
          )
          return null
        }
        const meta = (await metaRes.json()) as {
          ok?: boolean
          result?: { file_path?: string; file_size?: number }
        }
        const path = meta.result?.file_path
        if (!path) {
          logger.warn({ kind: att.kind }, "getFile sin file_path")
          return null
        }
        if (meta.result?.file_size && meta.result.file_size > maxBytes) {
          logger.warn(
            { kind: att.kind, size: meta.result.file_size },
            "media excede el límite"
          )
          return null
        }
        // 2) descargar el binario. La URL contiene el token → jamás loguearla.
        const fileRes = await fetch(`${API}/file/bot${botToken}/${path}`)
        if (!fileRes.ok) {
          logger.warn(
            { kind: att.kind, status: fileRes.status },
            "download no-2xx"
          )
          return null
        }
        const buf = new Uint8Array(await fileRes.arrayBuffer())
        if (buf.byteLength > maxBytes) {
          logger.warn(
            { kind: att.kind, size: buf.byteLength },
            "media excede el límite"
          )
          return null
        }
        return {
          kind: att.kind,
          mediaType: att.mediaType,
          ref: att.fileId,
          data: buf,
        }
      } catch (err) {
        logger.warn(
          { kind: att.kind, err: err instanceof Error ? err.message : "?" },
          "download falló"
        )
        return null
      }
    },
  }
}
