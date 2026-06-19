// updateVisitor: el camino OWNER → VISITANTE del bucle de escalación (hermana de `escalate`, que es visitante→owner).
// Cuando el owner, EN un hilo de escalada YA RESUELTA, CORRIGE un dato que ya se le había transmitido al visitante,
// Vaio le avisa la actualización al visitante en su voz. El modelo compone el mensaje (intención NL); el SISTEMA
// resuelve a qué visitante y hace el push (ConversationResumer), reportando si LLEGÓ de verdad.
//
// ⚓ INVARIANTE #8 — el modelo pasa SOLO el `message` (lenguaje natural); el routing/identidad del visitante los
// resuelve el sistema desde el hilo (threadOrigin.visitor). Cero ids/keys del modelo.
// ⚓ INVARIANTE #9 — UNA tool auto-contenida: resuelve destinatario + push + feedback en un execute.
// ⚓ INVARIANTE #10 / gating contextual — `available` solo en un hilo de escalada resuelta (threadOrigin presente):
// fuera de ahí NI se instancia (el modelo no cree que puede avisarle a un visitante que no existe).
// ⚓ #1 — toda rama responde; degrada honesto si no hay push. VETO del owner en 2 capas (modelo + backstop regex).

import { tool } from "ai"
import { z } from "zod"
import type { ActionContext, ActionDescriptor } from "./types.js"

/** Backstop del veto (capa 2): el owner pidió NO avisarle al visitante. La capa 1 es el modelo (no llama la tool);
 *  esto la respalda si el modelo se distrae (Inv #1: la petición del owner gana). Abstracto (Inv #2), es/en. */
const VISITOR_VETO_RE =
  /\bno\s+(le\s+|lo\s+|les\s+)?(avis|notif|comuniq|cuent|dig|transmit|coment)|(don'?t|do not|no need to)\s+(notify|tell|message|ping|update|inform|let\s+(them|him|her))/i

export const updateVisitor: ActionDescriptor = {
  name: "updateVisitor",
  sideEffecting: true,
  clearance: "owner",
  // Solo tiene sentido en un hilo de escalada YA RESUELTA (hay un visitante a quien actualizar).
  available: (ctx: ActionContext) => ctx.threadOrigin != null,
  build(ctx: ActionContext) {
    return tool({
      description:
        "Avisale al visitante que había preguntado una ACTUALIZACIÓN sobre lo que ya le transmitiste, cuando el " +
        "owner corrige/cambia ese dato en este hilo. Pasá el mensaje para el visitante en lenguaje natural (yo " +
        "resuelvo a quién y se lo hago llegar). Usala cuando lo que se le dijo al visitante quedó desactualizado. " +
        "NO la llames si el owner pidió explícitamente NO avisarle al visitante. No pases ids.",
      inputSchema: z.object({
        message: z
          .string()
          .min(1)
          .describe(
            "La actualización para el visitante, en lenguaje natural (qué cambió respecto de lo que ya se le dijo)."
          ),
      }),
      execute: async ({ message }, { toolCallId }) => {
        const t0 = Date.now()
        const done = (ok: boolean, output: string): string => {
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "updateVisitor",
            ok,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
        // Capa 2 del veto: el owner pidió no avisar → no empujamos (su petición gana, aunque el modelo llamara).
        if (ctx.userText && VISITOR_VETO_RE.test(ctx.userText)) {
          return done(
            true,
            "No le avisé al visitante (me pediste que no lo hiciera)."
          )
        }
        const origin = ctx.threadOrigin
        const visitor = origin?.visitor
        if (!origin || !visitor) {
          // Sin hilo/origen de visitante recuperable (p.ej. el visitante vino por web sin push) → honesto.
          return done(
            true,
            "No tengo un visitante al que avisarle en vivo desde acá (puede que haya preguntado sin un canal con push)."
          )
        }
        if (!ctx.conversationResumer) {
          return done(
            false,
            "No puedo avisarle al visitante ahora mismo (canal de retomo no disponible)."
          )
        }
        try {
          const { delivered } =
            await ctx.conversationResumer.resumeConversation({
              conversationKey: visitor.conversationKey,
              channel: visitor.channel as "web" | "telegram",
              locale: visitor.locale,
              originalQuestion: origin.question,
              injectedAnswer: message,
              kind: "update",
            })
          return done(
            true,
            delivered
              ? "Listo, se lo actualicé al visitante."
              : "Anotado, pero el visitante no está accesible para avisarle en vivo ahora."
          )
        } catch {
          return done(false, "No pude avisarle al visitante ahora mismo.")
        }
      },
    })
  },
}
