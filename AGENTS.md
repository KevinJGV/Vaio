# AGENTS.md

Las instrucciones de desarrollo agéntico de este repo viven en **[`CLAUDE.md`](CLAUDE.md)**
(canónico): comandos, workflow óptimo por sesión/tarea/iteración (con Definition of Done),
uso obligatorio de **context7** para APIs de librerías, convenciones, seguridad/costo y
verificación. El diseño/arquitectura completo está en **[`docs/SPEC.md`](docs/SPEC.md)**.

Cualquier agente o herramienta que retome este proyecto: **lee `CLAUDE.md` y `docs/SPEC.md`
antes de tocar nada.**

## OMO workflow (when using OpenCode/OMO)

### Session start ritual

**Read CLAUDE.md at session start.** The DCP profile excludes `**/CLAUDE.md` from auto-context,
but an explicit `Read` tool call bypasses the exclude. Always run:

```
Read /home/vin/Documents/Vaio/CLAUDE.md
```

Then load OMO state:

1. **Read `.omo/state.md`** — live WIP state, current task, open blockers, history.
2. **Read `.omo/learnings.md`** — gotchas, anti-patterns, lessons learned.
3. **Read `docs/SPEC.md`** — foundational design (shared with Claude, single source of truth).

If `.omo/state.md` or `.omo/learnings.md` don't exist yet, load the **omo-ritual** skill
for the session-start procedure (it handles first-time seeding from `docs/NEXT-STEPS.md`
and `docs/LEARNINGS.md`).

### Cross-tool namespace rule

Claude uses `docs/NEXT-STEPS.md` + `docs/LEARNINGS.md`. OMO uses `.omo/state.md` +
`.omo/learnings.md`. Both are git-tracked. **Do NOT cross-write** — each tool writes its
own namespace. OMO never touches `docs/NEXT-STEPS.md` or `docs/LEARNINGS.md`; Claude never
touches `.omo/`.

### Anti-drift rule

Code is the source of truth. If `.omo/state.md` disagrees with the codebase, reconcile
`.omo/` first — the code wins.
