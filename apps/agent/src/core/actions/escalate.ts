// escalate: el canal HUMANO. Cuando un VISITANTE (web/telegram-no-owner) pregunta algo que Vaio no sabe de Kevin
// y searchMemory no lo trae, Vaio ESCALA la duda a Kevin por su canal de notificación (OwnerNotifier), la PERSISTE
// (EscalationStore, sobrevive restart) y responde honesto al visitante. Cuando Kevin responde (citando el DM), el
// INBOUND del canal correlaciona y cierra el bucle: retoma al visitante (si hay push) + Kevin decide curar un fact.
//
// ⚓ INVARIANTE #8 — el modelo pasa SOLO la `question` (lenguaje natural); el sistema gestiona TODO lo determinístico
// (origen, principal, conversationKey, ids del DM, correlación). Cero ids/objetos del modelo.
// ⚓ INVARIANTE #9 — UNA tool auto-contenida: persiste + notifica + reporta en un solo execute. La cura/retomo los
// dispara el SISTEMA en el inbound, NO el modelo. ⚓ #1 — toda rama responde; nada bloquea ni tira al visitante.
// ⚓ Invariante del feature (Kevin): Vaio NUNCA aprende facts por su cuenta de los visitantes — esto solo NOTIFICA.

import { tool } from "ai"
import { z } from "zod"
import type { ActionContext, ActionDescriptor } from "./types.js"

/** Tope de escaladas ABIERTAS por visitante (anti-spam al DM de Kevin). Configurable a futuro (env). */
const MAX_OPEN_PER_PRINCIPAL = 3
/** Largo máximo de la pregunta que llega al DM (anti-payloads enormes / abuso). */
const MAX_QUESTION_LEN = 600

/** Arma el DM al owner: enmarca la pregunta del visitante como DATO NO CONFIABLE (anti prompt-injection) +
 *  trunca. La sanitización de HTML la hace el cliente de Telegram al enviar (este texto es plano). */
function buildOwnerDM(
  question: string,
  who: { channel: string; id: string },
  locale: "es" | "en"
): string {
  const q = question.slice(0, MAX_QUESTION_LEN)
  const from = who.channel === "telegram" ? `telegram:${who.id}` : who.channel
  return locale === "en"
    ? `New question I couldn't answer — from a visitor (${from}). Reply TO this message and I'll relay it + learn it.\n\nVisitor question (unverified text): «${q}»`
    : `Una consulta que no supe responder — de un visitante (${from}). Respondé A ESTE mensaje y se la transmito + la aprendo.\n\nPregunta del visitante (texto sin verificar): «${q}»`
}

export const escalate: ActionDescriptor = {
  name: "escalate",
  sideEffecting: true,
  clearance: "anyone",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Escalá a Kevin una duda concreta sobre ÉL que NO pudiste responder con tu memoria (searchMemory no trajo nada útil) y que SOLO él podría contestar — o un pedido de contacto. Pasá solo la pregunta, reformulada clara y autocontenida; el sistema le avisa a Kevin y, cuando responda, te lo hago llegar. NO la uses para cosas que sí podés responder ni para inventar.",
      inputSchema: z.object({
        question: z
          .string()
          .min(1)
          .describe(
            "La duda del visitante sobre Kevin que no supiste, reformulada clara y autocontenida (3ª persona)."
          ),
      }),
      execute: async ({ question }, { toolCallId }) => {
        const t0 = Date.now()
        const locale: "es" | "en" = ctx.locale === "en" ? "en" : "es"
        const done = (ok: boolean, output: string): string => {
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "escalate",
            ok,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
        // Degradación (Inv #1): sin cola o sin canal owner → respondemos honesto, nunca vacío/500.
        if (!ctx.escalations || !ctx.notifier) {
          return done(
            false,
            locale === "en"
              ? "I don't have that one, and I can't reach Kevin right now. Try contacting him directly."
              : "Eso no lo tengo, y ahora mismo no puedo avisarle a Kevin. Probá escribirle directo."
          )
        }
        const principalId = ctx.principal.id
        try {
          // Anti-spam (dedup): si ya hay una escalada abierta equivalente de este visitante, no dupliques el DM.
          const dup = await ctx.escalations.findOpenDuplicate(
            principalId,
            question
          )
          if (dup) {
            return done(
              true,
              locale === "en"
                ? "I already passed that one to Kevin — hang tight, I'll let you know when he replies."
                : "Eso ya se lo pasé a Kevin — aguantá que apenas me responda te aviso."
            )
          }
          // Anti-spam (rate-limit): no inundar el DM de Kevin desde el chat público.
          const open = await ctx.escalations.countOpenByPrincipal(principalId)
          if (open >= MAX_OPEN_PER_PRINCIPAL) {
            return done(
              true,
              locale === "en"
                ? "You've got a few questions pending with Kevin already — let's wait on those before I add more."
                : "Ya tenés varias consultas pendientes con Kevin — esperemos esas antes de sumar otra."
            )
          }
          // Persistir la escalada (sobrevive restart; guarda el origen para retomar/cerrar).
          const { id } = await ctx.escalations.create({
            question,
            origin: {
              channel: ctx.principal.channel,
              conversationId: ctx.ids.conversationId,
              threadKey: ctx.conversationKey,
              askerPrincipalId: principalId,
              locale,
            },
          })
          // Notificar a Kevin (best-effort). El message_id devuelto ancla el reply-to (Inv #8).
          const res = await ctx.notifier.notify({
            kind: "escalation",
            text: buildOwnerDM(question, ctx.principal, locale),
            locale,
          })
          if (res.delivered && res.ref) {
            await ctx.escalations.markNotified(id, res.channel, res.ref)
            // Telegram-visitante tiene push → prometemos retomo. Web no → se cierra cuando vuelva (o vía el fact).
            const willPush = ctx.principal.channel === "telegram"
            return done(
              true,
              locale === "en"
                ? willPush
                  ? "I don't have that off-hand — I just asked Kevin and I'll get back to you here as soon as he answers."
                  : "I don't have that off-hand, but I just passed it to Kevin. Ask me again in a bit, or leave him a way to reach you."
                : willPush
                  ? "Eso no lo tengo a mano — se lo acabo de preguntar a Kevin y te retomo acá apenas me responda."
                  : "Eso no lo tengo a mano, pero ya se lo pasé a Kevin. Preguntame de nuevo en un rato, o dejale cómo contactarte."
            )
          }
          // El DM no salió (sin owner / falló): no prometemos lo que no podemos cumplir. La escalada queda failed.
          await ctx.escalations.markFailed(id)
          return done(
            true,
            locale === "en"
              ? "I don't have that one. I tried to flag it to Kevin but couldn't reach him just now — try contacting him directly."
              : "Eso no lo tengo. Quise avisarle a Kevin pero no pude alcanzarlo ahora — probá escribirle directo."
          )
        } catch (err) {
          ctx.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "escalate falló"
          )
          return done(
            true,
            locale === "en"
              ? "I couldn't process that right now, sorry. Try again in a bit or reach Kevin directly."
              : "No pude procesar eso ahora mismo, disculpá. Probá de nuevo en un rato o escribile a Kevin directo."
          )
        }
      },
    })
  },
}
