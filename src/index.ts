import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { runAgent, type ChatBody } from "./agent.js";

const app = new Hono();

// Auth: el proxy del portafolio manda el header `x-agent-key`. Sin match → 401.
// (El proxy es el único que conoce AGENT_API_KEY → protege el costo del agente.)
app.use("/chat", async (c, next) => {
  const key = c.req.header("x-agent-key");
  if (!process.env.AGENT_API_KEY || key !== process.env.AGENT_API_KEY) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.get("/health", (c) => c.json({ ok: true, service: "vaio" }));

// POST /chat  { messages: [{role, content}], locale?: "es"|"en" }  → respuesta del agente
app.post("/chat", async (c) => {
  const body = await c.req.json<ChatBody>();
  return runAgent(c, body);
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`Vaio escuchando en :${port}`);
