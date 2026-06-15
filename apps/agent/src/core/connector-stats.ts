// Lógica PURA de los conectores de stats (sin I/O): racha de contribuciones, agregación de lenguajes por
// bytes, formateos de top-N. Testeable con fixtures (el `today` se inyecta para determinismo).

interface Day {
  contributionCount: number
  date: string
}

/** Racha ACTUAL: cuenta hacia atrás desde el último día con contribuciones. Si hoy está en 0 pero el día
 *  previo tiene contribuciones, la racha sigue viva (no la rompe el día en curso). */
export function currentStreak(days: Day[], today: string): number {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  let streak = 0
  for (let i = sorted.length - 1; i >= 0; i--) {
    const day = sorted[i]
    if (!day) break
    if (day.contributionCount > 0) {
      streak++
    } else if (day.date === today) {
      // El día en curso aún sin commits no rompe la racha: seguí mirando ayer.
      continue
    } else {
      break
    }
  }
  return streak
}

/** Racha MÁS LARGA: máxima corrida de días con contribuciones. */
export function longestStreak(days: Day[]): number {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  let best = 0
  let run = 0
  for (const day of sorted) {
    if (day.contributionCount > 0) {
      run++
      best = Math.max(best, run)
    } else {
      run = 0
    }
  }
  return best
}

interface LangNode {
  languages: { edges: { size: number; node: { name: string } }[] }
}

/** Agrega bytes por lenguaje sobre todos los repos, ordena desc, calcula % sobre el total y recorta a top-5.
 *  Porcentajes redondeados a entero. */
export function aggregateLanguages(
  nodes: LangNode[]
): { name: string; percent: number }[] {
  const bytes = new Map<string, number>()
  for (const repo of nodes) {
    for (const edge of repo.languages.edges) {
      bytes.set(edge.node.name, (bytes.get(edge.node.name) ?? 0) + edge.size)
    }
  }
  const total = [...bytes.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return []
  return [...bytes.entries()]
    .map(([name, size]) => ({ name, percent: Math.round((size / total) * 100) }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 5)
}

/** "Nombre (X%), …" para los top-n por percent (WakaTime languages/editors/projects). */
export function topByPercent(
  items: { name: string; percent: number }[],
  n: number
): string {
  return items
    .slice(0, n)
    .map((i) => `${i.name} (${Math.round(i.percent)}%)`)
    .join(", ")
}

/** "Nombre (Xh), …" para los top-n por minutos jugados (Steam). */
export function topByPlaytime(
  games: { name: string; playtime_forever: number }[],
  n: number
): string {
  return [...games]
    .sort((a, b) => b.playtime_forever - a.playtime_forever)
    .slice(0, n)
    .map((g) => `${g.name} (${Math.round(g.playtime_forever / 60)}h)`)
    .join(", ")
}
