import { chunkText } from "../../core/chunking.js"
import type { DocChunk } from "../../ports/memory.js"

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": "vaio-ingest" } })
  if (!res.ok) {
    // Sin logger en este scope (ingesta batch) → el body va en el mensaje del Error, que ingest.ts loguea.
    const body = await res.text().catch(() => "")
    throw new Error(
      `${url} → ${res.status}${body ? ` · ${body.slice(0, 200)}` : ""}`
    )
  }
  return res.text()
}

export function toChunks(
  source: string,
  url: string,
  text: string
): DocChunk[] {
  return chunkText(text).map((chunk) => ({ source, url, chunk }))
}
