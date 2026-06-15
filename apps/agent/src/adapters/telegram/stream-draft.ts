// Consume el ReadableStream<Uint8Array> del core (el mismo que streamea el web), acumula el texto y llama
// `onUpdate(parcial)` THROTTLEADO → para emitir drafts en vivo sin pasarse de los rate-limits de Telegram.
// Devuelve el texto final completo. `onUpdate` es best-effort (un fallo no corta el pump). `now` inyectable
// para testear la cadencia sin reloj real.

export async function pumpStream(
  stream: ReadableStream<Uint8Array>,
  onUpdate: (partial: string) => void | Promise<void>,
  opts?: { throttleMs?: number; now?: () => number }
): Promise<string> {
  const throttleMs = opts?.throttleMs ?? 700
  const now = opts?.now ?? (() => Date.now())
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let acc = ""
  let lastSent = Number.NEGATIVE_INFINITY
  const safeUpdate = async (p: string): Promise<void> => {
    try {
      await onUpdate(p)
    } catch {
      // best-effort: el draft es accesorio; nunca corta el drenaje del stream.
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      acc += decoder.decode(value, { stream: true })
      const t = now()
      if (t - lastSent >= throttleMs) {
        lastSent = t
        await safeUpdate(acc)
      }
    }
    acc += decoder.decode() // flush de bytes multibyte pendientes
    await safeUpdate(acc) // el parcial FINAL siempre se emite
    return acc
  } finally {
    reader.releaseLock()
  }
}
