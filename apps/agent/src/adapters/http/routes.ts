// Adapter HTTP (canal de entrada): rutas Hono finas. El routing vive acá; la lógica en
// el core. Fase 2 sumará canales (Telegram/correo) como otros adapters sobre el mismo core.

import { chatBodySchema } from "@vaio/contracts";
import { Hono } from "hono";
import { type Agent, courtesy } from "../../core/agent.js";
import { agentAuth } from "./auth.js";

export interface RouteDeps {
  agentApiKey: string | undefined;
  /** null → /chat degrada a respuesta de cortesía (sin OpenRouter configurado). */
  agent: Agent | null;
}

export function buildApp({ agentApiKey, agent }: RouteDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "vaio" }));

  app.use("/chat", agentAuth(agentApiKey));

  // POST /chat  { messages: [{role, content}], locale?: "es"|"en" }  → stream
  app.post("/chat", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = chatBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad request" }, 400);
    }
    const locale = parsed.data.locale ?? "es";

    if (!agent) {
      return c.text(courtesy(locale), 200);
    }
    try {
      return agent.stream(parsed.data.messages, locale).toTextStreamResponse();
    } catch (err) {
      console.error("[http] /chat error:", err);
      return c.text(courtesy(locale), 200);
    }
  });

  return app;
}
