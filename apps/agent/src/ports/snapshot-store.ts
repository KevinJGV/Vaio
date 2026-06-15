// Puerto de la SERIE TEMPORAL de snapshots de conectores (append-only + lectura reciente + poda). El core/ingest
// depende de esta interfaz; el adapter (adapters/neon-snapshots) la implementa sobre `connector_snapshots`.
// Materia prima de las "trends"; seam graph-ready (un adapter de grafo enchufaría acá en Fase 3).

/** Un snapshot de la actividad de UNA fuente en un momento (el texto formateado de `collect()` + su fecha). */
export interface ConnectorSnapshot {
  source: string
  capturedAt: Date
  content: string
}

export interface SnapshotStore {
  /** Inserta el snapshot (capturedAt = ahora si no se pasa). Devuelve false si fue saltado por DEDUP (su hash
   *  coincide con el último de ese source → nada cambió). */
  append(input: {
    source: string
    content: string
    capturedAt?: Date
  }): Promise<boolean>
  /** Últimos `n` snapshots de un source, MÁS RECIENTE primero. */
  listRecent(source: string, n: number): Promise<ConnectorSnapshot[]>
  /** Poda: deja solo los `keep` más recientes de un source (borra el resto). */
  prune(source: string, keep: number): Promise<void>
}
