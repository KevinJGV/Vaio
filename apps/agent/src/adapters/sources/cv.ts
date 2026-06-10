import { htmlToText } from "../../core/chunking.js";
import type { DocChunk } from "../../ports/memory.js";
import { fetchText, toChunks } from "./util.js";

/** CV de Kevin (ES/EN), texto limpio desde cv.vindevsito.dev. */
export async function collectCV(): Promise<DocChunk[]> {
  const targets = [
    { source: "cv", url: "https://cv.vindevsito.dev/" },
    { source: "cv-en", url: "https://cv.vindevsito.dev/en/" },
  ];
  const out: DocChunk[] = [];
  for (const t of targets) {
    const text = htmlToText(await fetchText(t.url));
    out.push(...toChunks(t.source, t.url, text));
  }
  return out;
}
