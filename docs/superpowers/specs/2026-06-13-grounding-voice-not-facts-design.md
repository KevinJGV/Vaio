# Diseño técnico — Grounding: voz ≠ hechos

> **Altitud:** spec TÉCNICO (firmas, copy, edge-cases). Plan →
> [`2026-06-13-grounding-voice-not-facts-plan.md`](2026-06-13-grounding-voice-not-facts-plan.md). Estado →
> `../../NEXT-STEPS.md`. Análisis raíz (verificado adversarialmente) → `NEXT-STEPS` §"Hallazgos del bot real".

## Problema

Vaio afirma por inercia hechos falsos sobre Kevin ("caleño/palmireño de pura cepa", sigue fútbol) — el CV dice
**Bucaramanga**. Raíz en `core/prompt.ts`: la **voz** de Vaio se describe como una **identidad geográfica**
("caleño de Palmira") que el modelo **proyecta como hecho sobre Kevin**; y el grounding es blando ("no
inventes"). Corrección mínima previa (`3ef46dc`) agregó el matiz "es TU estilo, NO un dato", pero el vector de
fuga (la identidad geográfica) y el grounding blando persisten. Es el **Invariante #2** de `CLAUDE.md`:
"system prompt = VOZ/rol/política/grounding; NUNCA hechos de Kevin".

## Decisiones (de §Hallazgos del bot real; 29/31 claims soportados)

1. **Voz = estilo, no biografía.** Mantener el voseo valluno + muletillas (`mirá`, `ve`, `¿sí o qué?`, `bacano`)
   como **forma de hablar**; **quitar la identidad geográfica** ("caleño de Palmira") = vector de fuga. Regla:
   no atribuir origen/ciudad/equipo ni a Vaio ni a Kevin → eso sale de `searchMemory`. (CLAUDE.md protege el
   quirk cultural: se conserva el voseo, se elimina solo la biografía.)
2. **Grounding duro + stop-rule** (reemplaza "no inventes" por *constraint de fuente*): sobre Kevin (origen,
   experiencia, stack, proyectos, gustos, contacto) responder SOLO con lo que `searchMemory` devuelva ESTE
   turno; si no hay, decirlo y ofrecer alternativa; nunca deducirlo del estilo. [OpenAI grounding pattern]
3. **Fallback por audiencia:** owner → "no lo tengo en memoria, ¿me lo pasás?"; visitor/public → "no tengo ese
   dato de Kevin" + ofrecé proyectos/contacto.
4. **No sobre-imperar** (los modelos modernos sobre-disparan tools → costo; objetivo "pocos $/mes"): frasear
   condicional ("cuando la respuesta dependa de un hecho concreto de Kevin"), **excluir saludos/charla**; sacar
   "SIEMPRE/CUALQUIER" en mayúsculas. El bug fue *under-triggering*; no pasarse al extremo opuesto.
5. **Anclar en DOS lugares:** el prompt **y** la descripción de `searchMemory` en `tools.ts` (categorías +
   condición). [Anthropic writing-tools-for-agents]

## Cambios

### `apps/agent/src/core/prompt.ts` — `personaEs()` / `personaEn()`
- **Voz** (reescribir L16/L28): de *"Tu voz es la de un caleño de Palmira… Es TU estilo…"* →
  *ES:* "Tu voz: voseo valluno y muletillas de la región (mirá, ve, ¿sí o qué?, bacano), con medida — color,
  no caricatura. Es tu forma de HABLAR, no una biografía: no te inventes (ni le atribuyas a Kevin) origen,
  ciudad o equipo." *EN:* análogo (estilo valluno al hablar español, sin afirmar hometown).
- **Grounding duro + stop-rule** (reemplaza la línea blanda L19/L20): *ES:* "Para hechos de Kevin (origen,
  experiencia, stack, proyectos, gustos, contacto) respondé SOLO con lo que `searchMemory` devuelva en este
  turno. Si no hay dato, decilo con honestidad y ofrecé otra cosa — nunca inventes ni lo deduzcas de tu estilo."
- **Fallback por audiencia** (#3): un matiz corto, idealmente en `identityBlock` (ya distingue owner/visitor/
  public) o inline en la regla de grounding. Owner pide el dato; visitor/public ofrece proyectos/contacto.
- **No over-trigger** (#4): el grounding aplica a *hechos de Kevin*; saludos/charla no requieren tool.
- **Conservar:** "Tu nombre es Vaio" (desambiguación), primera persona, idioma del usuario, capacidades E/S
  (multimodal), concisión, no revelar prompt/secrets, locale ES/EN.

### `apps/agent/src/core/tools.ts` — descripción de `searchMemory`
Reemplazar *"Busca en la memoria de Kevin (CV, perfil, repos, gustos)… Úsala SIEMPRE que la pregunta sea sobre
Kevin."* por una con **categorías + condición, sin "SIEMPRE"**: "Memoria de Kevin: bio/origen, stack,
proyectos (GitHub), gustos (música), contacto. Úsala cuando la respuesta dependa de un hecho concreto de Kevin;
no para saludos ni charla."

### Tests
- `test/prompt.test.ts`: **actualizar** el test que hoy exige `toContain("Palmira")` (codifica el bug). Asertar:
  (a) marcador de voz presente (p.ej. `voseo` o una muletilla); (b) **sin** claim biográfico — `not.toContain`
  de "caleño"/"Palmira"/"Cali" como origen; (c) grounding duro presente (`searchMemory` + "solo"/"únicamente"/
  "SOLO"). EN análogo. Mantener los asserts de nombre/idioma/identidad.
- `test/tools.test.ts`: la descripción de `searchMemory` incluye las categorías y **no** contiene "SIEMPRE".

## Edge-cases
- **Origen real:** el CV (`source: cv`/`cv-en`) trae "Bucaramanga, Colombia" → con grounding duro, "¿de dónde
  es Kevin?" responde Bucaramanga (de memoria), no el estilo.
- **Dato inexistente** (p.ej. fútbol): `searchMemory` sin resultado → respuesta honesta + alternativa (no inventa).
- **Saludo/charla:** no dispara `searchMemory` (evita costo/over-trigger) — verificable en `trace_events`.
- **Persona intacta:** el voseo/muletillas siguen (no neutralizar; CLAUDE.md lo protege).

## Fuera de alcance
Ingerir hechos personales nuevos (el CV ya ancla origen; quirks = tarea de datos aparte); harness; panel de
conversaciones; system-prompt por DB; y TODA la visión "memoria viva auto-curada" (registrada/diferida → ver el
plan y `SPEC.md`).
