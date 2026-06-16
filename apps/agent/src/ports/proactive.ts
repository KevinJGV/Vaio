// Puerto de TURNOS PROACTIVOS (Nivel C): el seam que deja a Vaio RETOMAR solo tras una tarea en background.
// Un action dispara una tarea larga y la registra acá; al COMPLETAR, el adapter del canal re-entra el loop del
// agente con la duda original y entrega la respuesta INICIADA por el agente (Telegram-first; el web no puede push
// tras cerrar el turno → null). El core depende de este puerto; la re-entrada/push vive en el adapter (Inv #4).
// Ver docs/superpowers/specs/2026-06-16-proactive-turns-design.md.

export interface ProactiveResume {
  /** Registra una tarea en background; al COMPLETAR re-entra el loop con la duda original y entrega la respuesta
   *  por el canal. best-effort: NO bloquea el turno actual, NUNCA tira (Inv #1). Canal sin push (web) → null
   *  (el llamador usa `?.` → no-op). `label` = solo para observabilidad. */
  resume(task: Promise<unknown>, opts?: { label?: string }): void
}
