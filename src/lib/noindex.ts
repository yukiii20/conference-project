import { useEffect } from 'react'

/** Adds <meta name="robots" content="noindex"> while mounted. Tidiness only — not a security boundary. */
export function useNoIndex() {
  useEffect(() => {
    const tag = document.createElement('meta')
    tag.setAttribute('name', 'robots')
    tag.setAttribute('content', 'noindex')
    document.head.appendChild(tag)
    return () => {
      document.head.removeChild(tag)
    }
  }, [])
}
