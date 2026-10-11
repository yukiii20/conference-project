import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_CONFERENCE_COLOR, darken, getAccessibleTextColor, isValidHexColor, lighten } from '../lib/color'

type ConferenceBadgeAnimationProps = {
  /** Conference code, shown in the badge's top band. */
  code: string
  /** Conference name — the fallback label when there's no short_name. */
  name: string
  /** conferences.short_name; shown next to the photo circle when set. */
  shortName?: string | null
  /** Conference's uploaded logo URL; falls back to initials when absent. */
  logoUrl?: string | null
  /** Conference's primary colour; falls back to the platform default. */
  color?: string
  /** Called once, shortly after the drop/swing settles (buttons fade in on this, like the old scene). */
  onDone?: () => void
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Longer codes need a smaller font to stay inside the top band — no DOM
// measuring needed, the code is short plain text in practice.
function bandFontSize(code: string): number {
  if (code.length <= 6) return 15
  if (code.length <= 9) return 12
  return 9
}

/** "Cyber Security" -> "CS", "Icai" -> "IC" — a short fallback for a missing logo. */
function initialsOf(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

const NAME_MAX_FONT = 11
const NAME_MIN_FONT = 9
const NAME_MAX_WIDTH = 42

type NameFit = { lines: string[]; fontSize: number }

const LOOP_MS = 6000
// The rig (drop + damped swing) is fully settled by keyframe 52% — fire onDone
// there so the CTA buttons fade in once the badge has actually landed.
const SETTLE_MS = Math.round(LOOP_MS * 0.52)

export function ConferenceBadgeAnimation({ code, name, shortName, logoUrl, color, onDone }: ConferenceBadgeAnimationProps) {
  const accent = color && isValidHexColor(color) ? color : DEFAULT_CONFERENCE_COLOR
  const bandColor = darken(accent, 0.15)
  const lanyardColor = lighten(accent, 0.35)
  const cardTint = lighten(accent, 0.92)
  const photoTint = lighten(accent, 0.8)
  const nameColor = darken(accent, 0.35)
  const codeTextColor = getAccessibleTextColor(bandColor)
  const tickMarkColor = getAccessibleTextColor(accent)

  const clipId = useId()
  const photoClipId = useId()
  const shineGradId = useId()

  const displayName = (shortName && shortName.trim()) || name
  const initials = initialsOf(displayName)

  const measureRef = useRef<SVGTextElement>(null)
  const [nameFit, setNameFit] = useState<NameFit>({ lines: [displayName], fontSize: NAME_MAX_FONT })

  // Fire onDone once — immediately under reduced motion (nothing to wait on),
  // otherwise once the first drop/swing has settled.
  useEffect(() => {
    if (prefersReducedMotion()) {
      onDone?.()
      return
    }
    const t = window.setTimeout(() => onDone?.(), SETTLE_MS)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Word-wrap the conference's short name into up to 2 lines, measured with
  // getComputedTextLength() so it actually fits the space next to the photo
  // circle — shrinking the font, then truncating with "…", if it still doesn't.
  useLayoutEffect(() => {
    const node = measureRef.current

    function measure(text: string, fontSize: number): number {
      if (!node) return 0
      node.setAttribute('font-size', String(fontSize))
      node.textContent = text
      try {
        return node.getComputedTextLength()
      } catch {
        return 0
      }
    }

    function wrapWords(words: string[], fontSize: number): { line: string; rest: string[] } {
      let line = ''
      let i = 0
      for (; i < words.length; i++) {
        const attempt = line ? `${line} ${words[i]}` : words[i]
        if (measure(attempt, fontSize) <= NAME_MAX_WIDTH) {
          line = attempt
        } else if (line === '') {
          line = words[i]
          i += 1
          break
        } else {
          break
        }
      }
      return { line, rest: words.slice(i) }
    }

    const words = displayName.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      setNameFit({ lines: [], fontSize: NAME_MAX_FONT })
      return
    }

    for (let fontSize = NAME_MAX_FONT; fontSize >= NAME_MIN_FONT; fontSize--) {
      const first = wrapWords(words, fontSize)
      if (first.rest.length === 0) {
        setNameFit({ lines: [first.line], fontSize })
        return
      }
      const second = wrapWords(first.rest, fontSize)
      if (second.rest.length === 0) {
        setNameFit({ lines: [first.line, second.line], fontSize })
        return
      }
      if (fontSize === NAME_MIN_FONT) {
        let line2 = second.line
        while (line2.length > 1 && measure(`${line2}…`, fontSize) > NAME_MAX_WIDTH) {
          line2 = line2.slice(0, -1)
        }
        setNameFit({ lines: [first.line, `${line2}…`], fontSize })
        return
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName])

  const nameLineStep = nameFit.fontSize * 1.3
  const nameY1 = nameFit.lines.length === 1 ? 110 : 101

  return (
    <div className="badge-anim-wrap">
      <style>{`
        .badge-anim-wrap { width: 150px; height: 190px; margin: 0 auto; }
        .badge-anim-wrap svg { display: block; width: 100%; height: 100%; }
        @media (max-width: 639px) {
          .badge-anim-wrap { width: 120px; height: 150px; }
        }

        /* Drop in, damped swing, rest, lift back out — then the loop repeats.
           transform-origin is in SVG user units (the lanyard's top anchor), so
           no transform-box is needed here — it already rotates around the
           right point. */
        .badge-anim-rig {
          transform-origin: 75px 0px;
          animation: badge-cycle-rig ${LOOP_MS}ms cubic-bezier(.32,.64,.3,1) infinite;
        }
        @keyframes badge-cycle-rig {
          0%   { transform: translateY(-140px) rotate(0deg); }
          12%  { transform: translateY(0) rotate(14deg); }
          20%  { transform: translateY(0) rotate(-10deg); }
          28%  { transform: translateY(0) rotate(7deg); }
          36%  { transform: translateY(0) rotate(-4deg); }
          44%  { transform: translateY(0) rotate(2deg); }
          52%  { transform: translateY(0) rotate(0deg); }
          88%  { transform: translateY(0) rotate(0deg); }
          100% { transform: translateY(-140px) rotate(0deg); }
        }

        /* Verified tick, pops into the photo circle around 60-80% of the loop. */
        .badge-tick-pop {
          transform-box: fill-box;
          transform-origin: center;
          transform: scale(0);
          opacity: 0;
          animation: badge-tick-pop-kf ${LOOP_MS}ms ease-in-out infinite;
        }
        @keyframes badge-tick-pop-kf {
          0%, 58%   { transform: scale(0); opacity: 0; }
          62%       { transform: scale(0.4); opacity: 1; }
          70%       { transform: scale(1.15); opacity: 1; }
          76%, 86%  { transform: scale(1); opacity: 1; }
          92%, 100% { transform: scale(0); opacity: 0; }
        }

        /* Soft shine, clipped to the card shape, sweeping diagonally while resting. */
        .badge-shine-sweep {
          transform: translateX(-40px);
          opacity: 0;
          animation: badge-shine-kf ${LOOP_MS}ms ease-in-out infinite;
        }
        @keyframes badge-shine-kf {
          0%, 54%   { transform: translateX(-40px); opacity: 0; }
          60%       { opacity: 0.9; }
          76%       { transform: translateX(190px); opacity: 0.9; }
          82%, 100% { transform: translateX(230px); opacity: 0; }
        }

        /* Status dot in the card's bottom corner, pulsing on its own 1.6s beat. */
        .badge-pulse-ring {
          transform-box: fill-box;
          transform-origin: center;
          transform: scale(0.8);
          opacity: 0.6;
          animation: badge-pulse-ring-kf 1.6s ease-out infinite;
        }
        @keyframes badge-pulse-ring-kf {
          0%   { transform: scale(0.8); opacity: 0.6; }
          70%  { transform: scale(2.2); opacity: 0; }
          100% { transform: scale(2.2); opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .badge-anim-rig,
          .badge-tick-pop,
          .badge-shine-sweep,
          .badge-pulse-ring { animation: none !important; }
        }
      `}</style>

      <svg viewBox="0 0 150 190" role="img" aria-label={`${code} conference badge`}>
        <defs>
          <clipPath id={clipId}>
            <rect x="20" y="44" width="110" height="92" rx="12" />
          </clipPath>
          <clipPath id={photoClipId}>
            <circle cx="52" cy="106" r="22" />
          </clipPath>
          <linearGradient id={shineGradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g className="badge-anim-rig">
          {/* Lanyard, exiting the top of the frame. */}
          <path d="M58,46 L44,0" stroke={lanyardColor} strokeWidth="9" strokeLinecap="round" fill="none" />
          <path d="M92,46 L106,0" stroke={lanyardColor} strokeWidth="9" strokeLinecap="round" fill="none" />

          {/* Badge clip/grommet. */}
          <circle cx="75" cy="42" r="7" fill={lanyardColor} />
          <circle cx="75" cy="42" r="3" fill={cardTint} />

          {/* Badge body. */}
          <rect x="20" y="44" width="110" height="92" rx="12" fill={cardTint} stroke={bandColor} strokeWidth="1.5" />

          {/* Shine sweep, clipped to the card shape. */}
          <g clipPath={`url(#${clipId})`}>
            <g className="badge-shine-sweep">
              <rect x="-15" y="35" width="22" height="110" rx="4" transform="rotate(-20 -4 90)" fill={`url(#${shineGradId})`} />
            </g>
          </g>

          {/* Top band with the conference code. */}
          <rect x="26" y="50" width="98" height="28" rx="7" fill={bandColor} />
          <text
            x="75"
            y="64"
            textAnchor="middle"
            dominantBaseline="central"
            fontWeight={700}
            fontSize={bandFontSize(code)}
            fill={codeTextColor}
          >
            {code}
          </text>

          {/* Logo circle (or initials, when there's no logo) + conference name. */}
          {logoUrl ? (
            <>
              <image
                href={logoUrl}
                x="30"
                y="84"
                width="44"
                height="44"
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#${photoClipId})`}
              />
              <circle cx="52" cy="106" r="22" fill="none" stroke="#ffffff" strokeWidth="2.5" />
            </>
          ) : (
            <>
              <circle cx="52" cy="106" r="22" fill={photoTint} stroke={bandColor} strokeWidth="1.2" />
              <text
                x="52"
                y="106"
                textAnchor="middle"
                dominantBaseline="central"
                fontWeight={700}
                fontSize="16"
                fill={accent}
              >
                {initials}
              </text>
            </>
          )}

          <text fontWeight={700} fontSize={nameFit.fontSize} fill={nameColor}>
            {nameFit.lines.map((line, i) => (
              <tspan key={i} x="84" y={nameY1 + i * nameLineStep}>
                {line}
              </tspan>
            ))}
          </text>

          {/* Verified tick, pops into the photo circle. */}
          <g className="badge-tick-pop">
            <circle cx="66" cy="120" r="10" fill={cardTint} />
            <circle cx="66" cy="120" r="7.5" fill={accent} />
            <path
              d="M61.5,120 L65,123.5 L71,116.5"
              stroke={tickMarkColor}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>

          {/* Live status dot, bottom corner. */}
          <circle className="badge-pulse-ring" cx="116" cy="126" r="4" fill="none" stroke={accent} strokeWidth="2" />
          <circle cx="116" cy="126" r="4" fill={accent} />
        </g>

        {/* Off-canvas measuring node for getComputedTextLength() — never visible. */}
        <text ref={measureRef} x="-9999" y="-9999" fontWeight={700} aria-hidden="true" />
      </svg>
    </div>
  )
}
