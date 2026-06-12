// Variables del contexto Hono compartidas por los adapters de canal (http + telegram). En un módulo
// aparte para que ambos las importen sin ciclo de imports.

import type { Logger } from "../../ports/logger.js"

export type Variables = { requestId: string; log: Logger }
