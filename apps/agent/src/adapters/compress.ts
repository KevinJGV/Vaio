// Adapter del compresor: envuelve @vaio/compress (determinístico, offline, sin llamada a modelo).

import { compress, countTokens, expand } from "@vaio/compress"
import type { Compressor, Intensity } from "../ports/compress.js"

export function createCompressor(): Compressor {
  return {
    compress: (text: string, intensity?: Intensity) =>
      compress(text, intensity ? { intensity } : {}),
    expand: (text: string) => expand(text),
    countTokens: (text: string) => countTokens(text),
  }
}
