import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { onSlowRequest } from '../lib/api'
import { Icon } from './ui/Icon'

/**
 * Render's free tier sleeps after 15 minutes idle and takes up to ~50s to
 * wake back up — without this, the first visitor after a quiet period just
 * sees a blank/stuck screen with no clue anything is happening. Mounted
 * once at the app root; shows the moment any request (see api.ts's
 * trackSlowRequest) has been pending for more than 5 seconds, hides the
 * moment none are.
 */
export function SlowRequestBanner() {
  const [slow, setSlow] = useState(false)

  useEffect(() => onSlowRequest(setSlow), [])

  if (!slow) return null

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-brand px-4 py-2 text-sm text-on-brand shadow-md"
    >
      <Icon icon={Loader2} size={16} className="animate-spin" />
      Waking up the server, this can take up to a minute…
    </div>
  )
}
