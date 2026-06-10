import { htmlToText } from "../../core/chunking.js"
import type { DocChunk } from "../../ports/memory.js"
import { fetchText, toChunks } from "./util.js"

/** "Sobre mí" / posicionamiento desde el portafolio público. */
export async function collectPortfolio(): Promise<DocChunk[]> {
  const targets = [
    { source: "me", url: "https://vindevsito.dev/me" },
    { source: "contact", url: "https://vindevsito.dev/contact" },
  ]
  const out: DocChunk[] = []
  for (const t of targets) {
    const text = htmlToText(await fetchText(t.url))
    out.push(...toChunks(t.source, t.url, text))
  }
  return out
}
