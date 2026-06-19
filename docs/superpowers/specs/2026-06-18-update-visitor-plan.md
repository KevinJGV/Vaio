# Plan — `updateVisitor` (owner → visitante) + gating contextual

> Par: [`-design.md`](2026-06-18-update-visitor-design.md) (firmas, framing, veto, edge-cases). No duplica.
> Branch: `feat/fact-lifecycle-inc2` (sigue a Inc 2). Decisiones de Kevin: tool hermana de `escalate`,
> nombre `updateVisitor`, automática + veto en 2 capas; gating contextual como eje reusable del harness.

## Fases (secuencia con dependencias)

1. **Eje de gating contextual.** `ActionDescriptor.available?(ctx)` + filtro en el registry. Entregable:
   una tool puede declararse disponible solo en cierto contexto; se omite por completo si no. Test del
   registry primero. → habilita instanciar updateVisitor solo en el hilo.
2. **Origen del visitante.** `ThreadOrigin.visitor` + `findResolvedByTopic` lo trae (JOIN ya existe;
   agrega columnas de origen). Depende del tipo. → da el destinatario.
3. **Resumer con `kind:"update"`.** `ResumeConversationInput.kind` + framing de actualización + parse de
   routing desde conversationKey. → el push al visitante con el encuadre correcto.
4. **Tool `updateVisitor`.** Nueva action (contextual+owner) + registro + veto backstop + `userText`/
   `conversationResumer` en ActionContext. Depende de 1-3.
5. **Cableado.** `TurnContext.conversationResumer`; agent.ts lo pasa a buildTools (+`userText`);
   handleTurn crea y pasa el resumer. Depende de 4.
6. **Verificación.** typecheck + biome + tests (nuevos) + `/health`; commit. e2e de Kevin (Telegram).

## Verificación macro
- Unit: registry (gating contextual), update-visitor (push + veto + degradación), resume (framing/route),
  escalation store (visitor en findResolvedByTopic), wiring Telegram. Ver design §Tests.
- e2e (Kevin, Telegram): escalar desde otra cuenta → responder en el hilo → corregir en el hilo →
  el visitante recibe la actualización; repetir diciendo "corregilo pero NO le avises" → NO llega (veto).

## Estrategia de ejecución
**Directo (orquestador-yo), sin subagentes.** Vertical slice **secuencial y acoplado** (un tipo y un
flujo que atraviesan registry → port → adapter → core → adapter Telegram; cada fase depende de la
anterior). No hay trabajo independiente paralelizable. La exploración del subsistema ya se hizo (3
Explore en la sesión de Inc 2 + lecturas dirigidas acá). Implementación directa con TDD por archivo.

## Riesgos / mitigaciones
- **Circular resumer↔agent** → resumer inyectado por-turno vía TurnContext desde el adapter (que tiene
  el agent), como `resume`.
- **Loop de relay** → el turno sintético del visitante es audience=visitor → updateVisitor (owner) no se
  le instancia; + `resume:null`/denylist escalate ya en el resumer.
- **Veto ignorado por el modelo** → backstop determinístico (`VISITOR_VETO_RE` sobre `ctx.userText`).
- **Fuga de capacidad inexistente** → gating contextual omite la tool fuera del hilo; su única mención
  (nota del hilo) es co-gated. (La coherencia general del prompt = followup aparte.)
- **Core tocando formato de keys Telegram** → el resumer parsea el routing desde conversationKey.

## Post-merge
Reconciliar `NEXT-STEPS.md` (cerrar Inc 2 + updateVisitor tras OK de Kevin del e2e; mover a Historial).
El followup general (coherencia prompt↔toolset) ya quedó registrado como WIP propio.
