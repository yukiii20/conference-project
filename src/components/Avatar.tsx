import { publicImageUrl } from '../lib/storage'

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({
  photoPath,
  name,
  size = 'h-8 w-8',
}: {
  photoPath: string | null | undefined
  name: string
  size?: string
}) {
  const url = publicImageUrl(photoPath ?? null)
  if (url) {
    return <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
  }
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-medium text-brand`}>
      {getInitials(name)}
    </span>
  )
}
