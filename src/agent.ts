import type { Context } from "hono";

export interface ChatBody {
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  locale?: "es" | "en";
}

// TODO(fase1): loop agéntico real con Vercel AI SDK (`streamText`) + OpenRouter
// (cadena de fallback de OPENROUTER_MODELS) + tool `searchMemory(query)` (memory.ts)
// que inyecta contexto RAG al system prompt. Responder en `locale`. Streamear la
// respuesta (passthrough hasta el proxy del portafolio).
// ⚠️ Verificar la API de streaming del AI SDK v6 con context7 ANTES de implementar.
export async function runAgent(c: Context, body: ChatBody) {
  const last = body.messages.at(-1)?.content ?? "";
  // Placeholder: aún sin LLM — deja el skeleton corriendo (health + /chat responden).
  return c.json({
    placeholder: true,
    note: "Vaio scaffold — agente real pendiente (ver docs/SPEC.md, Fase 1).",
    received: last,
    locale: body.locale ?? "es",
  });
}
