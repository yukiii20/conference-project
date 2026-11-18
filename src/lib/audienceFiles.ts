/** "1.2 MB", "340 KB", "12 B" - for file lists. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export type AbstractLike = {
  title: string
  abstract: string
  submission_code: string | null
  keywords: string[]
  track: { id: string; name: string }
  authors: Array<{ full_name: string; affiliation: string | null }>
}

/** Groups abstracts by track name (alphabetical), keeping the server order inside a track. */
export function groupByTrack<T extends AbstractLike>(items: T[]): Array<{ track: string; items: T[] }> {
  const map = new Map<string, T[]>()
  for (const item of items) map.set(item.track.name, [...(map.get(item.track.name) ?? []), item])
  return [...map].sort(([a], [b]) => a.localeCompare(b)).map(([track, list]) => ({ track, items: list }))
}
