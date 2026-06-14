# Diseño técnico — Ingesta de fuentes CRUDAS de repos ("Vaio se nutre solo", pasos 1+2)

> **Altitud:** spec técnico de bajo nivel (arquitectura, firmas, filtros, patrones, manejo de la API, edge-cases).
> El plan de alto nivel + estrategia de ejecución vive en [`2026-06-14-raw-repo-ingestion-plan.md`](2026-06-14-raw-repo-ingestion-plan.md).
> Norte y contexto: `docs/SPEC.md` §"Vaio se nutre solo" · memoria `vaio-self-nourishing-memory-vision`.

## Objetivo y alcance

Que `pnpm ingest` pueble la memoria (`documents`) con el **contenido crudo** (markdown + código) de repos
curados —**incluyendo el propio `KevinJGV/Vaio`** (self-awareness)— leído vía **GitHub API**, no del HTML
desplegado. Materializa los **pasos 1 (fuentes crudas) + 2 (self-awareness)** del norte. **Fuera de alcance:**
paso 3 (acceso on-demand como read-action del harness) y paso 5 (grafos).

**Principio de diseño:** reusar el patrón de ingesta existente (`collectX()→DocChunk[]` + el loop
`clearSource`+`upsertDocuments` de `ingest.ts`); toda la **decisión** es pura en `core/` (testeable sin red),
el **I/O** vive en el adapter. No hay migración: reúsa la tabla `documents`.

## Modelo de datos (sin DDL nueva)

`DocChunk = { source, url, chunk }` (en `@vaio/contracts`). Para fuentes crudas:
- **`source = "repo:<owner>/<repo>"`** (ej. `repo:KevinJGV/Vaio`). Un solo source por repo →
  `clearSource("repo:owner/repo")` re-ingesta ese repo sin tocar otros ni las fuentes existentes
  (`cv`/`github`/`lastfm`). El prefijo `repo:` evita colisión con el collector `github` actual
  (`source="github"`, que solo guarda descripciones — coexisten: catálogo vs contenido crudo).
- **`url = "https://github.com/<owner>/<repo>/blob/<branch>/<path>"`** → procedencia clickeable al archivo
  exacto en el branch resuelto (estable aunque cambie el default).
- `searchMemory` ya hace `unionAll(documents, facts)` sin filtrar por source → los chunks crudos entran al RAG
  **sin tocar el core del agente**.

## Componentes

### `core/secret-scan.ts` (PURO — seguridad crítica, Invariante #5)

```ts
export interface SecretFinding { pattern: string; line: number }
export function scanSecrets(content: string): SecretFinding[]   // [] = limpio
export function hasSecret(content: string): boolean
```

**Capa 2** de defensa (contenido, tras bajar el archivo que pasó el filtro de path). Patrones alto-recall:

| Patrón | Regex (aprox.) |
|---|---|
| AWS access key | `AKIA[0-9A-Z]{16}` |
| Private key header | `-----BEGIN (RSA \|EC \|OPENSSH \|PGP )?PRIVATE KEY-----` |
| GitHub PAT | `ghp_[A-Za-z0-9]{36}` |
| Slack | `xox[baprs]-[A-Za-z0-9-]+` |
| Stripe | `sk_(live\|test)_[0-9a-zA-Z]{24,}` |
| OpenRouter | `sk-or-v1-[a-f0-9]{16,}` |
| OpenAI-style | `sk-[A-Za-z0-9]{20,}` |
| Postgres/Neon URL con pass | `postgres(ql)?:\/\/[^:\s]+:[^@\s]+@` |
| JWT | `eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.` |
| Asignación genérica | `(secret\|api[_-]?key\|token\|password\|passwd\|bearer)\s*[:=]\s*['"][^'"]{8,}['"]` |

**Política: SKIP el archivo entero** (no redact) — redactar deja el riesgo de un patrón no cubierto; descartar
es la postura segura. **Anti-falso-positivo:** el `{8,}` entre comillas perdona `.env.example` (valores vacíos /
placeholders `your-key-here`/`xxx`) y `const KEY = process.env.KEY`. Verificado en tests contra el `.env.example` real.

### `core/repo-ingest.ts` (PURO — árbol, filtros, clasificación)

```ts
export interface TreeEntry { path: string; type: "blob" | "tree" | "commit"; size?: number; sha: string }

export interface RepoIngestPolicy {
  includeExtensions: ReadonlySet<string>        // con punto, lowercase
  includeFilenames: ReadonlySet<string>         // README, Dockerfile, .env.example...
  excludePathSegments: readonly string[]        // node_modules, dist...
  excludeFilenamePatterns: readonly RegExp[]    // .env*, *.pem, lockfiles...
  maxFileBytes: number
  maxChunksPerRepo: number
}
export const DEFAULT_REPO_POLICY: RepoIngestPolicy

export type SkipReason =
  | "not-a-blob" | "excluded-path" | "sensitive-name" | "extension-not-included" | "too-large"
export interface FilterDecision {
  kept: TreeEntry[]
  skipped: { path: string; reason: SkipReason }[]   // nada de truncado silencioso
}
export function filterTree(entries: TreeEntry[], policy: RepoIngestPolicy): FilterDecision

export function isProseFile(path: string): boolean          // .md/.mdx/.txt/README → true
export function languageOf(path: string): string           // "typescript" | "markdown" | ...
export function isProbablyText(content: string): boolean    // NUL bytes / ratio no-imprimible → false (binario)
```

**`DEFAULT_REPO_POLICY`:**
- **includeExtensions:** `.md .mdx .txt .ts .tsx .js .jsx .mjs .cjs .json .sql .yml .yaml .toml .sh .css .astro .html`
- **includeFilenames:** `README` `Dockerfile` `LICENSE` `.gitignore` `.env.example`
- **excludePathSegments** (match por segmento, case-insensitive): `node_modules` `dist` `build` `.next` `out`
  `coverage` `.git` `.turbo` `.cache` `vendor` `migrations/meta` ; glob `*.min.*`
- **excludeFilenamePatterns** (secrets/ruido por path, **capa 1**): `/(^|\/)\.env($|\.)/i` (salvo `.env.example`,
  por la whitelist de `includeFilenames`), `\.pem$` `\.key$` `\.p12$` `\.pfx$` `\.crt$` `id_rsa` `\.keystore$`
  `credentials.*` `secrets?\.(json|ya?ml|ts)$` `\.npmrc$` `pnpm-lock\.yaml$` `.*-lock\.(json|yaml)$` `\.lock$`
- **maxFileBytes** = 100*1024 (evaluado con `entry.size` **antes** de bajar → ahorra fetch)
- **maxChunksPerRepo** = 800

**Orden de `filterTree`:** descarta `type !== "blob"` (`not-a-blob`) → match `excludePathSegments`
(`excluded-path`) → match `excludeFilenamePatterns` salvo whitelist (`sensitive-name`) → ext/filename no incluida
(`extension-not-included`) → `size > maxFileBytes` (`too-large`). Cada descarte va a `skipped` con su `reason`.

### `core/code-chunking.ts` (PURO — chunking de código + procedencia)

```ts
export function chunkCode(text: string, opts?: { maxChars?: number; overlapLines?: number }): string[]
// default maxChars=900 (alineado con chunkText), overlapLines=8.
// Corta en límites de LÍNEA (nunca a mitad de línea); acumula líneas hasta maxChars; overlap de N líneas.

export function withProvenanceHeader(
  chunks: string[],
  ctx: { repo: string; path: string; lang: string }
): string[]
// código: "// repo: <repo> · path: <path> · lang: <lang>\n" + chunk
// prosa : "<!-- repo: <repo> · path: <path> -->\n" + chunk  (cuando isProseFile)
```

El header es **load-bearing** para el recall: inyecta repo/path/lang al espacio de embeddings (un chunk de
código suelto no se recupera por "¿cómo Vaio cablea los adapters en index.ts?" sin esos términos). El header
**cuenta** contra `maxChars`. **Prosa** (`.md/.mdx/.txt`) reúsa `chunkText` de `core/chunking.ts` + header HTML.

### `adapters/sources/github-api.ts` (I/O — helper compartido, extraído de `github.ts`)

```ts
export async function githubApi<T>(path: string, token?: string): Promise<T>    // JSON, accept vnd.github+json
export async function githubRaw(path: string, token?: string): Promise<string>  // texto crudo, accept vnd.github.raw+json
```

Headers comunes: `authorization: Bearer ${token}` (si hay), `user-agent: "vaio-ingest"`,
`x-github-api-version: 2026-03-10`. En error: `throw new Error(\`... status:${res.status} ${body.slice(0,200)}\`)`
(idéntico al patrón actual → `ingest.ts` lo loguea). `github.ts` se refactoriza para importar `githubApi`
(mismo comportamiento; lo cubre el test de `collectGithub`).

### `adapters/sources/repo.ts` (I/O — el collector)

```ts
export interface RawRepoSpec { owner: string; repo: string; branch?: string }
export interface RawRepoConfig {
  repos: RawRepoSpec[]; token?: string; policy?: RepoIngestPolicy; logger?: Logger
}
export async function collectRawRepo(cfg: RawRepoConfig): Promise<DocChunk[]>
```

Orquestación **por repo** (cada repo en `try/catch` → un fallo loguea y sigue; **best-effort**):
1. branch = `spec.branch ?? (await githubApi<{default_branch}>(\`/repos/${o}/${r}\`)).default_branch`
2. `{ tree, truncated } = await githubApi(\`/repos/${o}/${r}/git/trees/${branch}?recursive=1\`)`.
   Si `truncated` → `logger.warn` claro (no fallo; procesa lo que vino).
3. `{ kept, skipped } = filterTree(tree, policy)` → `logger.info({repo, kept: kept.length, skipped: byReason})`.
4. Por archivo de `kept` (también en `try/catch` → skip `fetch-failed` sin abortar el repo):
   `raw = await githubRaw(\`/repos/${o}/${r}/contents/${path}?ref=${branch}\`)` →
   `if (!isProbablyText(raw)) skip "binary"` → `if (hasSecret(raw)) skip "secret-detected"` (log) →
   chunks = `isProseFile ? chunkText : chunkCode` → `withProvenanceHeader` → push `DocChunk{source,url,chunk}`.
5. **Cap:** procesar **prosa antes que código** (prioriza docs); al llegar a `maxChunksPerRepo`, parar y
   `logger.warn` cuántos archivos/chunks quedaron fuera (no truncado silencioso).

### `config.ts` (env)

```ts
RAW_SOURCE_REPOS: z.string().optional(),                                  // csv "owner/repo[@branch]"
RAW_FILE_MAX_BYTES: z.coerce.number().int().positive().default(100*1024),
RAW_REPO_MAX_CHUNKS: z.coerce.number().int().positive().default(800),

export function rawSourceRepos(env: Env): RawRepoSpec[]
// split(","), trim, descarta sin "/", parte "repo@branch" por "@". Puro/testeable (estilo speechChain).
```

Vacío/ausente → degrada limpio (el collector no se agrega). `.env.example`: `RAW_SOURCE_REPOS=KevinJGV/Vaio`
de default (self-awareness fuera de la caja); el slug del portafolio lo agrega Kevin.

### `ingest.ts` (wiring)

Collector condicional (patrón de `lastfm`): si `rawSourceRepos(env).length > 0`, push
`{ name: "raw-repos", run: () => collectRawRepo({ repos, token: env.GITHUB_TOKEN, policy, logger }) }`;
si no, `logger.info("raw-repos: sin RAW_SOURCE_REPOS, salto.")`. **No cambia** el loop `clearSource`+`upsert`.

## Manejo de la GitHub API (verificado vía context7, docs.github.com/en/rest)

- **Tree:** `GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1` (acepta nombre de branch como `tree_sha`) →
  `{ sha, url, tree:[{path,mode,type,sha,size}], truncated }`. **Límite 100k entries / 7MB** → `truncated:true`
  (repos curados muy por debajo; manejado con WARN + best-effort, sin fallback de sub-árboles — followup).
- **Contenido raw:** `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}` con
  `Accept: application/vnd.github.raw+json` → **bytes crudos** (sin base64). Sirve archivos **hasta 100MB**
  (cap nuestro 100KB queda holgado). *(Descartada la Blobs API por obligar a decodificar base64.)*
- **default_branch:** `GET /repos/{owner}/{repo}` → `default_branch`.
- **Rate limit:** 5000 req/h con token; por repo ≈ 1 (branch) + 1 (tree) + N (archivos) → muy lejos del límite.
  Leer `x-ratelimit-remaining`; si cerca de 0, parar el repo + log (best-effort).

## Edge cases / riesgos

- **Secrets en memoria pública** (crítico): doble capa (path + contenido) + skip-no-redact; los contenedores
  obvios (`.env`/`.pem`) caen por path antes de bajarse. Riesgo residual = patrón no cubierto en código legítimo
  → mitigado por set alto-recall + tests.
- **Costo/volumen de embeddings** (de a uno, sin batch): acotado por filtro + `maxFileBytes` + `maxChunksPerRepo`
  con log de descartes. **Followup (fuera de alcance):** dedup por hash de chunk para no re-embeber lo no cambiado.
- **Árbol truncado:** WARN + best-effort. **Repos privados/404:** best-effort por repo. **Binarios mal
  clasificados:** `isProbablyText` los descarta. **Encoding:** `res.text()` decodifica UTF-8; no-UTF8 → no-texto → skip.
- **Colisión de source con `github`:** evitada por el prefijo `repo:`.

## Plan de tests (TDD — todo puro, sin red)

- **`secret-scan.test.ts`** (el más crítico): detecta cada patrón; **NO** falso-positivo en `.env.example` real,
  `process.env.X`, comentarios, placeholders.
- **`repo-ingest.test.ts`:** `filterTree` (incluye `.ts/.md`, excluye `.png/.lock`, `node_modules/`/`dist/` a
  cualquier nivel, `.env`/`secret.key`/`id_rsa`/`credentials.json` por nombre, **permite `.env.example`**, `>max`
  → `too-large`, `type:tree` → `not-a-blob`; `skipped` con `reason`); `isProseFile`; `languageOf`; `isProbablyText`.
- **`code-chunking.test.ts`:** `chunkCode` nunca parte una línea, respeta `maxChars` (incl. header), overlap de
  líneas, archivo vacío/1-línea sin crash; `withProvenanceHeader` (HTML para prosa, `//` para código; contiene repo+path+lang).
- **`config.test.ts`** (extender): `rawSourceRepos` parsea csv con `@branch` y descarta malformados; vacío→`[]`.
- **`sources.test.ts`** (extender, `mockFetch`): `collectRawRepo` produce `DocChunk[]` con `source="repo:o/r"` +
  url blob + header; 2º repo con 404 en tree no rompe el 1º (best-effort); archivo con secret → no aparece.
