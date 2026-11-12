import { useState, type ImgHTMLAttributes, type ReactNode } from 'react'

/**
 * An <img> for uploaded files (logos, banners, photos) that never shows the browser's
 * broken-image icon: if the file can't be loaded (e.g. it is missing from storage), the
 * `fallback` is rendered instead - typically the first letter of a name or a neutral icon.
 *
 * Remount (or change `src`) to retry: the failed state is tied to the current `src`.
 */
export function SafeImage({
  src,
  fallback = null,
  onError,
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | null | undefined
  fallback?: ReactNode
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!src || failedSrc === src) return <>{fallback}</>
  return (
    <img
      {...rest}
      src={src}
      onError={(e) => {
        setFailedSrc(src)
        onError?.(e)
      }}
    />
  )
}

/** First letter of a name in a neutral circle/box - the default placeholder for a missing picture. */
export function InitialPlaceholder({ name, className = '' }: { name: string; className?: string }) {
  const letter = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <span aria-hidden="true" className={`flex items-center justify-center bg-surface-muted font-semibold text-text-muted ${className}`}>
      {letter}
    </span>
  )
}
