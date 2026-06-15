// Conector WakaTime — UNA fuente, dos facetas:
//  - live(): cuánto programó Kevin esta semana y en qué. Best-effort → null.
//  - collect(): tecnologías que usa de verdad, medidas por tiempo (último año) → DocChunk[] (snapshot).

import { topByPercent } from "../../core/connector-stats.js"
import type { Connector } from "../../ports/connector.js"
import type { DocChunk } from "../../ports/memory.js"
import { toChunks } from "../sources/util.js"

const BASE = "https://api.wakatime.com/api/v1"

interface WakaBucket {
  name: string
  percent: number
}
interface WakaStats {
  data?: {
    human_readable_total?: string
    total_seconds?: number
    languages?: WakaBucket[]
    editors?: WakaBucket[]
    projects?: WakaBucket[]
  }
}

export function createWakatimeConnector(cfg: { apiKey: string }): Connector {
  // Basic auth con la api_key en base64 (la key NUNCA se loguea).
  const auth = `Basic ${Buffer.from(cfg.apiKey).toString("base64")}`
  const get = async (range: string): Promise<WakaStats["data"] | null> => {
    const res = await fetch(`${BASE}/users/current/stats/${range}`, {
      headers: { authorization: auth },
    })
    if (!res.ok) return null // 202 (calculando) o error → sin datos
    return ((await res.json()) as WakaStats).data ?? null
  }

  return {
    name: "wakatime",

    async live(): Promise<string | null> {
      try {
        const data = await get("last_7_days")
        if (!data || !data.total_seconds) return null
        const langs = topByPercent(data.languages ?? [], 3)
        const total = data.human_readable_total ?? "un rato"
        return langs
          ? `⌨️ Esta semana Kevin programó ${total}, sobre todo en ${langs}`
          : `⌨️ Esta semana Kevin programó ${total}`
      } catch {
        return null
      }
    },

    async collect(): Promise<DocChunk[]> {
      const data = await get("last_year")
      if (!data) return []
      const langs = topByPercent(data.languages ?? [], 5)
      const editors = topByPercent(data.editors ?? [], 3)
      const projects = topByPercent(data.projects ?? [], 5)
      if (!langs && !editors && !projects) return []
      const text =
        `Tecnologías que Kevin usa de verdad, medidas por tiempo (WakaTime, último año): ` +
        `lenguajes ${langs || "—"}; editores ${editors || "—"}; proyectos ${projects || "—"}. ` +
        `Total: ${data.human_readable_total ?? "—"}.`
      return toChunks("wakatime", "https://wakatime.com", text)
    },
  }
}
