import { useEffect, useState } from 'react'

type Phase = 'idle' | 'dropping' | 'swaying'

type ConferenceBadgeAnimationProps = {
  /** Conference code, shown in the badge's top band. */
  code: string
  /** Called once, after the drop/swing settles (buttons fade in on this, like the old scene). */
  onDone?: () => void
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Longer codes need a smaller font to stay inside the ~76px-wide top band —
// no DOM measuring needed, the code is short plain text in practice.
function bandFontSize(code: string): number {
  if (code.length <= 6) return 15
  if (code.length <= 9) return 12
  return 9
}

export function ConferenceBadgeAnimation({ code, onDone }: ConferenceBadgeAnimationProps) {
  const reducedMotion = prefersReducedMotion()
  const [phase, setPhase] = useState<Phase>(() => (reducedMotion ? 'swaying' : 'idle'))

  // Kick off the drop on mount (skipped entirely under reduced motion).
  useEffect(() => {
    if (reducedMotion) {
      onDone?.()
      return
    }
    const t = window.setTimeout(() => setPhase('dropping'), 10)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleDropEnd() {
    if (phase !== 'dropping') return
    setPhase('swaying')
    onDone?.()
  }

  return (
    <div className="badge-anim-wrap">
      <style>{`
        .badge-anim-wrap { width: 130px; height: 150px; margin: 0 auto; }
        .badge-anim-wrap svg { display: block; width: 100%; height: 100%; }
        .badge-anim-rig { transform-origin: 65px 10px; }
        .badge-anim-dropping .badge-anim-rig { animation: badge-drop 1.4s cubic-bezier(.22,.9,.3,1) forwards; }
        .badge-anim-swaying .badge-anim-rig { animation: badge-sway 4s ease-in-out infinite; }

        @keyframes badge-drop {
          0%   { transform: translateY(-160px) rotate(0deg); }
          42%  { transform: translateY(0) rotate(16deg); }
          58%  { transform: translateY(0) rotate(-11deg); }
          72%  { transform: translateY(0) rotate(7deg); }
          84%  { transform: translateY(0) rotate(-4deg); }
          93%  { transform: translateY(0) rotate(2deg); }
          100% { transform: translateY(0) rotate(0deg); }
        }
        @keyframes badge-sway {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }

        @media (prefers-reduced-motion: reduce) {
          .badge-anim-rig { animation: none !important; }
        }
      `}</style>

      <svg viewBox="0 0 130 150" role="img" aria-label={`${code} conference badge`}>
        <g
          className={`badge-anim-rig ${
            phase === 'dropping' ? 'badge-anim-dropping' : phase === 'swaying' ? 'badge-anim-swaying' : ''
          }`}
          onAnimationEnd={handleDropEnd}
        >
          {/* Lanyard, exiting the top of the frame. */}
          <path d="M50,44 L38,0" stroke="#E8B4A2" strokeWidth="9" strokeLinecap="round" fill="none" />
          <path d="M80,44 L92,0" stroke="#E8B4A2" strokeWidth="9" strokeLinecap="round" fill="none" />

          {/* Badge clip/grommet. */}
          <circle cx="65" cy="40" r="6" fill="#E8B4A2" />
          <circle cx="65" cy="40" r="2.5" fill="#FBEDE7" />

          {/* Badge body. */}
          <rect x="15" y="42" width="100" height="100" rx="10" fill="#FBEDE7" stroke="#6E2A1A" strokeWidth="1.5" />
          <rect x="21" y="48" width="88" height="26" rx="6" fill="#6E2A1A" />
          <text
            x="65"
            y="61"
            textAnchor="middle"
            dominantBaseline="central"
            fontWeight={700}
            fontSize={bandFontSize(code)}
            fill="#FBEDE7"
          >
            {code}
          </text>

          <rect x="29" y="86" width="72" height="8" rx="4" fill="#6E2A1A" opacity="0.25" />
          <rect x="29" y="100" width="56" height="8" rx="4" fill="#6E2A1A" opacity="0.25" />
          <rect x="29" y="114" width="64" height="8" rx="4" fill="#6E2A1A" opacity="0.25" />
        </g>
      </svg>
    </div>
  )
}
