// Middleware de auth del agente: el proxy del portafolio manda `x-agent-key`. Sin match
// → 401. (El proxy es el único que conoce AGENT_API_KEY → protege el costo en tokens.)

import type { MiddlewareHandler } from "hono";

export function agentAuth(expectedKey: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    const key = c.req.header("x-agent-key");
    if (!expectedKey || key !== expectedKey) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
