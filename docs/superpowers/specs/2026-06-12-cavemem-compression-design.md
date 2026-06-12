# Design — Capa de compresión determinística (adopción de @cavemem/compress)

**Estado:** aprobado 2026-06-12 · rama `feat/conversational-core-telegram` (extiende la iteración 2).
**Plan (alto nivel):** [`2026-06-12-cavemem-compression-plan.md`](2026-06-12-cavemem-compression-plan.md).
**Relacionado:** memoria conversacional → [`2026-06-12-stateful-channels-telegram-design.md`](2026-06-12-stateful-channels-telegram-design.md).

## Contexto
La iteración 2 usa un **resumen LLM (lossy)** para la memoria. Para escalar tokens/recursos desde ahora
(conversaciones, RAG, y a futuro facts/ingesta) **adoptamos `@cavemem/compress`** (`JuliusBrussee/cavemem`):
**MIT · TypeScript · cero dependencias**, paquete aislado del SQLite/MCP/CLI del repo original. Es
**determinístico, offline, sin llamada a modelo**; preserva código/URLs/paths/fechas/versiones/números/
identificadores **byte-a-byte** (tokenizer agnóstico al idioma) y comprime solo prosa (quita fillers/
artículos/hedges/cortesías + abrevia + colapsa whitespace, guiado por `lexicon.json` por intensidad).

## Arquitectura: dos tiers + puerto
- **Tier 1 (determinístico, costo cero):** `@cavemem/compress` sobre el **contexto que se manda al modelo**.
- **Tier 2 (LLM, lossy):** el resumen rodante ya existente, solo para **acotar** hilos largos.
- El core depende de un **puerto `Compressor`**, no del paquete (ports/adapters; swappable; degradable).

## Vendoring → `packages/compress`
- Copiar `packages/compress/{src,test,tsconfig.json,package.json}` del repo. Renombrar package →
  **`@vaio/compress`**. **Preservar `LICENSE` MIT (copyright original)** + `NOTICE` acreditando a
  `JuliusBrussee/cavemem`. Entra al workspace (`packages/*`).
- API pública (`src/index.ts`): `compress(text, { intensity })`, `expand(text)`, `tokenize`,
  `redactPrivate`, `countTokens(text)`, tipo `Intensity = 'lite'|'full'|'ultra'`. **Síncrono.**
- Build = como `@vaio/contracts` (tsc → dist), orden topológico antes de `@vaio/agent`.
- **Gotcha:** `lexicon.ts` hace `import lex from './lexicon.json' with { type: 'json' }` (import
  attributes) → su tsconfig necesita `resolveJsonModule` + `module` nodenext/esnext (Node 24 lo soporta).

## Puerto + adapter (en `apps/agent`)
- `src/ports/compress.ts`:
  ```ts
  export type Intensity = "lite" | "full" | "ultra"
  export interface Compressor {
    compress(text: string, intensity?: Intensity): string
    expand(text: string): string
    countTokens(text: string): number
  }
  ```
- `src/adapters/compress.ts`: `createCompressor(): Compressor` envuelve `@vaio/compress`.
- Helper puro (en `core/`): `compressOrRaw(c: Compressor | null, text: string, intensity): string` → si
  `c` es null o `text` vacío, devuelve `text` (degradación).

## Qué se comprime y qué NO (regla dura)
- **SÍ:** resumen rodante (Tier 2) + **turnos históricos** (`convCtx.recent`) + **salida de `searchMemory`** (chunks RAG).
- **NO:** el **mensaje vivo del usuario** (es la query real) ni la **persona/policy** del system (voz de Vaio + se cachea).
- **Compresión al ENVIAR, no al guardar:** los turnos se persisten **crudos** en DB; se comprime al armar
  el prompt. `expand()` queda disponible para UI/progressive-disclosure futuro (no se usa aún).

## Integración
- `core/agent.ts`: `AgentDeps` suma `compressor: Compressor | null`. Al armar el turno: `summary →
  compress(...)` antes de `buildSystemPrompt`; cada `recent[i].content → compress(...)` antes de mapear a
  `ModelMessage`. Observabilidad: ahorro (`countTokens` antes/después) a log `debug` (liviano, sin secrets).
- `core/tools.ts`: `ToolDeps` suma `compressor`. En `searchMemory`, comprimir cada chunk antes de unir el
  `output`. `hits` igual; tokens ahorrados → log debug u opcional campo en `tool.result`.

## Léxico ES (en el package vendorizado)
- `lexicon.json` tiene `fillers|articles|hedges|pleasantries|abbreviations` por intensidad + `expansions`.
  Agregar entradas ES: artículos (el/la/los/las/un/una/unos/unas/lo), fillers (o sea, este, bueno, tipo,
  pues), hedges (quizá, creo que, me parece), cortesías (hola, gracias, por favor, dale), abreviaturas
  (también→tmb, porque→pq, para→pa, mensaje→msg) + expansions. Conservador primero.
- **Edge:** las regex usan `\b`; cuidar acentos/ñ (que `\b` no parta "configuración"/"diseño"). Validar en tests.

## Config
- `COMPRESS_ENABLED` (default true), `COMPRESS_INTENSITY` (`lite|full|ultra`, default `full`), opcional
  `COMPRESS_INTENSITY_RAG` (default `full`) vs conversación (default `lite` para no tocar matices del diálogo).
- `index.ts`: `compressor = COMPRESS_ENABLED ? createCompressor() : null`; inyectar en `createAgent` + tools.
  Boot log: `compress` on/off + intensidad.

## Edge cases / riesgos
- Degradación: `null`/fallo → texto crudo (nunca rompe el turno). `COMPRESS_ENABLED=false` lo apaga entero.
- Determinismo: garantía del paquete (`compress(x)` estable). Sirve para prompt-caching estable.
- Sobre-compresión hiriendo calidad de respuesta → intensidad configurable + conservadora en conversación;
  verificar con un `/chat` real que sigue citando bien el CV.
- Import attributes de `lexicon.json` (build del package). Acentos en regex `\b` (léxico ES).
- No comprimir la query viva ni la persona (si no, se degrada intención/voz).

## Transversalidad (seams, no en esta iteración)
El mismo `Compressor` sirve luego a **facts** (fase 2) e **ingesta** (comprimir prosa de chunks — ojo:
embeber el original, comprimir para contexto). Y habilita el norte "Vaio harness" (cavemem es TS+MCP).
