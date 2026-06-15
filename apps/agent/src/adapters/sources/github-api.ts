// Helper compartido de la GitHub REST API: JSON tipado + contenido raw.
// El I/O vive en el adapter; ingest.ts loguea el Error (status + body) aguas arriba.

const BASE = "https://api.github.com"
const API_VERSION = "2026-03-10"

function buildHeaders(accept: string, token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept,
    "user-agent": "vaio-ingest",
    "x-github-api-version": API_VERSION,
  }
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

/** GET a la GitHub REST API → JSON tipado. Lanza Error con status + body en error (lo loguea ingest.ts). */
export async function githubApi<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: buildHeaders("application/vnd.github+json", token),
  })
  if (!res.ok) {
    // El body de error de GitHub (rate-limit, permisos) va en el mensaje → visible al loguear aguas arriba.
    const body = await res.text().catch(() => "")
    throw new Error(
      `GitHub ${path} → ${res.status}${body ? ` · ${body.slice(0, 200)}` : ""}`
    )
  }
  return (await res.json()) as T
}

/** POST a la GitHub GraphQL API → `data` tipado. Lanza Error con status/body o si el payload trae `errors`
 *  (lo loguea el llamador). Requiere token (GraphQL no acepta requests anónimas). */
export async function githubGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string
): Promise<T> {
  const res = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: {
      authorization: `bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "vaio-ingest",
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `GitHub GraphQL → ${res.status}${body ? ` · ${body.slice(0, 200)}` : ""}`
    )
  }
  const json = (await res.json()) as { data?: T; errors?: unknown }
  if (json.errors || !json.data) {
    throw new Error(
      `GitHub GraphQL errores: ${JSON.stringify(json.errors)?.slice(0, 200)}`
    )
  }
  return json.data
}

/** GET de contenido RAW de un archivo (Contents API con Accept raw) → texto crudo (sin base64). */
export async function githubRaw(path: string, token?: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    headers: buildHeaders("application/vnd.github.raw+json", token),
  })
  if (!res.ok) {
    // Mismo manejo de error que githubApi: status + body recortado, visible al loguear aguas arriba.
    const body = await res.text().catch(() => "")
    throw new Error(
      `GitHub ${path} → ${res.status}${body ? ` · ${body.slice(0, 200)}` : ""}`
    )
  }
  return await res.text()
}
