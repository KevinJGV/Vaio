// TODO(fase1): pipeline de ingesta de fuentes públicas → memoria (memory.ts).
//
// Fuentes (desacopladas; se leen por HTTP/API, no acoplan repos):
//   - https://cv.vindevsito.dev/  y  /en/        → CV en texto limpio (ES/EN)
//   - https://vindevsito.dev/me , /contact       → "sobre mí" / posicionamiento
//   - GitHub API (GITHUB_TOKEN, GITHUB_USER)      → perfil, repos, lenguajes, READMEs
//   - Last.fm (LASTFM_API_KEY, LASTFM_USER)       → gustos musicales / now-playing
//
// Pipeline: fetch → limpiar a texto → chunk (~500-1000 tokens, con solape) →
//           embed → upsertDocuments(). Correr `npm run ingest` (a mano) y luego cron (Railway).

import { upsertDocuments } from "./memory.js";

async function main() {
  console.log("TODO(fase1): ingesta — ver docs/SPEC.md.");
  // ej: const chunks = await collectSources(); await upsertDocuments(chunks);
  void upsertDocuments;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
