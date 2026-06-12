# NOTICE — @vaio/compress

Este paquete es una **copia vendorizada** del paquete `@cavemem/compress` del proyecto
**cavemem** (https://github.com/JuliusBrussee/cavemem), licenciado **MIT** — ver `LICENSE`
(copyright original preservado: © 2026 Julius Brussee).

## Cambios respecto del upstream
- `lexicon.json` convertido a un módulo TS (`src/lexicon.data.ts`) para no depender de
  *import attributes* de JSON en el build con `tsc` (Vaio compila con tsc, no tsup).
- `package.json`/`tsconfig.json` adaptados a la convención del monorepo Vaio (`@vaio/compress`,
  build con `tsc`, sin `tsup`).
- Estilo reformateado a Biome (comillas dobles, sin `;`).
- **Léxico extendido a español** (entradas ES en `lexicon.data.ts`) para comprimir prosa en ES,
  manteniendo el comportamiento original en inglés.

El motor (tokenizer que preserva código/URLs/paths/números/identificadores byte-a-byte +
transformaciones de prosa por intensidad) es el de cavemem. Gracias a Julius Brussee.
