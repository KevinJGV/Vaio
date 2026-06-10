import { chunkText } from "../../core/chunking.js"
import type { DocChunk } from "../../ports/memory.js"

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": "vaio-ingest" } })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.text()
}

export function toChunks(
  source: string,
  url: string,
  text: string
): DocChunk[] {
  return chunkText(text).map((chunk) => ({ source, url, chunk }))
}
