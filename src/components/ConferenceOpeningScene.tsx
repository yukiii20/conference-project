import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_CONFERENCE_COLOR } from '../lib/color'

type Phase = 'idle' | 'playing' | 'holding' | 'resetting'

type ConferenceOpeningSceneProps = {
  /** Headline shown on the projector screen, e.g. "Welcome to ICAI 2026". */
  title: string
  /** Theme · dates · city, shown under the title on the projector screen. */
  subtitle: string
  /** Conference short name or code, shown on the laptop screen once it lights up. */
  laptopLabel: string
  /** Primary conference colour; falls back to the platform default. */
  color?: string
  /** Kept for API compatibility with callers; no longer used (the "play once" session logic was removed). */
  storageKey?: string
  /** Called once, the first time the scene reaches its finished frame. */
  onDone?: () => void
}

const PLAY_MS = 5500
const HOLD_MS = 500
const RESET_MS = 300
const RESET_HALF_MS = 150
const AUDIENCE_COUNT = 9

// Projector screen box (SVG viewBox units).
const SCREEN_X = 190
const SCREEN_Y = 28
const SCREEN_W = 300
const SCREEN_H = 118
const TITLE_PAD = 24

// Laptop lid "screen" box.
const LAPTOP_X = 540
const LAPTOP_Y = 152
const LAPTOP_W = 72
const LAPTOP_H = 55
const LAPTOP_PAD = 4

const DURATIONS: Record<Phase, number> = { idle: 0, playing: PLAY_MS, holding: HOLD_MS, resetting: RESET_MS }

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

type Fit = {
  titleText: string
  titleFontSize: number
  subtitleLines: string[]
  laptopText: string
  laptopFontSize: number
}

const INITIAL_FIT: Fit = { titleText: '', titleFontSize: 20, subtitleLines: [], laptopText: '', laptopFontSize: 12 }

export function ConferenceOpeningScene({ title, subtitle, laptopLabel, color, onDone }: ConferenceOpeningSceneProps) {
  const accent = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_CONFERENCE_COLOR
  const descId = useId()

  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const [phase, setPhase] = useState<Phase>(() => (prefersReducedMotion() ? 'holding' : 'idle'))
  const [resetFlash, setResetFlash] = useState(false)
  const [runId, setRunId] = useState(0)
  const [fit, setFit] = useState<Fit>(INITIAL_FIT)

  const [hovering, setHovering] = useState(false)
  const [inView, setInView] = useState(false)
  const [tabVisible, setTabVisible] = useState(() => document.visibilityState === 'visible')
  const paused = hovering || !inView || !tabVisible

  const stageRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<SVGTextElement>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const hasFiredDoneRef = useRef(false)
  const remainingRef = useRef<number>(0)

  function goTo(next: Phase) {
    remainingRef.current = DURATIONS[next]
    setPhase(next)
  }

  // --- Reduced motion (live OS-setting changes too) -----------------------
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (reducedMotion && phase !== 'holding') goTo('holding')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  // --- Pause sources: hover, viewport visibility, tab visibility ----------
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => setInView(Boolean(entries[0]?.isIntersecting)), {
      threshold: 0.2,
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    function onVisibility() {
      setTabVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // --- First start: once visible (and not paused by hover/hidden tab) -----
  useEffect(() => {
    if (reducedMotion) return
    if (phase === 'idle' && !paused) goTo('playing')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, reducedMotion])

  // --- Fire onDone once, the first time the scene finishes -----------------
  useEffect(() => {
    if (phase === 'holding' && !hasFiredDoneRef.current) {
      hasFiredDoneRef.current = true
      onDoneRef.current?.()
    }
  }, [phase])

  // --- Advance playing -> holding -> resetting, pausable -------------------
  useEffect(() => {
    if (reducedMotion || paused) return
    if (phase !== 'playing' && phase !== 'holding') return
    const duration = remainingRef.current
    const startedAt = Date.now()
    const t = window.setTimeout(() => {
      goTo(phase === 'playing' ? 'holding' : 'resetting')
    }, duration)
    return () => {
      window.clearTimeout(t)
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, reducedMotion])

  // --- Resetting: a quick, atomic 0.3s cross-fade back to the start frame --
  useEffect(() => {
    if (phase !== 'resetting') {
      setResetFlash(false)
      return
    }
    const mid = window.setTimeout(() => setResetFlash(true), RESET_HALF_MS)
    const end = window.setTimeout(() => {
      setRunId((n) => n + 1)
      goTo('playing')
    }, RESET_MS)
    return () => {
      window.clearTimeout(mid)
      window.clearTimeout(end)
    }
  }, [phase])

  function handleMouseEnter() {
    setHovering(true)
  }
  function handleMouseLeave() {
    setHovering(false)
  }

  // --- Text fitting: measured with getComputedTextLength(), re-run when ----
  // --- the conference data changes or the window is resized. ---------------
  function measureWidth(text: string, fontSize: number, fontWeight: number): number {
    const node = measureRef.current
    if (!node) return 0
    node.setAttribute('font-size', String(fontSize))
    node.setAttribute('font-weight', String(fontWeight))
    node.textContent = text
    try {
      return node.getComputedTextLength()
    } catch {
      return 0
    }
  }

  function fitSingleLine(raw: string, maxWidth: number, maxFont: number, minFont: number, weight: number) {
    for (let fontSize = maxFont; fontSize >= minFont; fontSize--) {
      if (measureWidth(raw, fontSize, weight) <= maxWidth) return { text: raw, fontSize }
    }
    let truncated = raw
    while (truncated.length > 1 && measureWidth(`${truncated}…`, minFont, weight) > maxWidth) {
      truncated = truncated.slice(0, -1)
    }
    return { text: truncated.length < raw.length ? `${truncated}…` : truncated, fontSize: minFont }
  }

  function wrapWords(words: string[], maxWidth: number, fontSize: number, weight: number) {
    let line = ''
    let i = 0
    for (; i < words.length; i++) {
      const attempt = line ? `${line} ${words[i]}` : words[i]
      if (measureWidth(attempt, fontSize, weight) <= maxWidth) {
        line = attempt
      } else if (line === '') {
        // A single word wider than the box — keep it anyway rather than an empty line.
        line = words[i]
        i += 1
        break
      } else {
        break
      }
    }
    return { line, rest: words.slice(i) }
  }

  function fitTwoLines(raw: string, maxWidth: number, fontSize: number, weight: number): string[] {
    const words = raw.split(/\s+/).filter(Boolean)
    if (words.length === 0) return []
    const first = wrapWords(words, maxWidth, fontSize, weight)
    if (first.rest.length === 0) return [first.line]
    const second = wrapWords(first.rest, maxWidth, fontSize, weight)
    let line2 = second.line
    if (second.rest.length > 0) {
      let truncated = line2
      while (truncated.length > 1 && measureWidth(`${truncated}…`, fontSize, weight) > maxWidth) {
        truncated = truncated.slice(0, -1)
      }
      line2 = `${truncated}…`
    }
    return [first.line, line2]
  }

  useLayoutEffect(() => {
    function recompute() {
      const titleMaxWidth = SCREEN_W - TITLE_PAD * 2
      const titleFit = fitSingleLine(title, titleMaxWidth, 20, 14, 700)
      const subtitleLines = fitTwoLines(subtitle, titleMaxWidth, 12, 400)
      const laptopMaxWidth = LAPTOP_W - LAPTOP_PAD * 2
      const laptopFit = fitSingleLine(laptopLabel, laptopMaxWidth, 12, 9, 600)
      setFit({
        titleText: titleFit.text,
        titleFontSize: titleFit.fontSize,
        subtitleLines,
        laptopText: laptopFit.text,
        laptopFontSize: laptopFit.fontSize,
      })
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle, laptopLabel])

  // Vertically centre the title + subtitle block inside the projector screen.
  const titleLineHeight = fit.titleFontSize * 1.2
  const subtitleFontSize = 12
  const subtitleLineHeight = subtitleFontSize * 1.3
  const subtitleGap = fit.subtitleLines.length > 0 ? 8 : 0
  const blockHeight = titleLineHeight + subtitleGap + fit.subtitleLines.length * subtitleLineHeight
  const blockTop = SCREEN_Y + SCREEN_H / 2 - blockHeight / 2
  const titleCenterY = blockTop + titleLineHeight / 2
  const subtitleBaselineY = blockTop + titleLineHeight + subtitleGap + subtitleLineHeight * 0.78
  const screenCenterX = SCREEN_X + SCREEN_W / 2
  const laptopCenterX = LAPTOP_X + LAPTOP_W / 2
  const laptopCenterY = LAPTOP_Y + LAPTOP_H / 2

  const baseClass =
    phase === 'holding'
      ? ''
      : phase === 'resetting'
        ? `coscene-reset-fade ${resetFlash ? 'coscene-pre' : ''}`
        : phase === 'playing'
          ? 'coscene-pre coscene-playing'
          : 'coscene-pre'
  const stageClass = `${baseClass} ${paused ? 'coscene-paused' : ''}`.trim()

  const audience = Array.from({ length: AUDIENCE_COUNT }, (_, i) => i)

  return (
    <div className="coscene-wrap">
      <style>{`
        .coscene-wrap { width: 100%; max-width: 720px; }
        .coscene-box {
          position: relative; width: 100%; aspect-ratio: 680 / 380;
          border-radius: 0.75rem; overflow: hidden; background: #eef1f6;
          opacity: 1; transition: opacity ${RESET_HALF_MS}ms linear;
        }
        .coscene-box svg { display: block; width: 100%; height: 100%; }
        .coscene-reset-fade { opacity: 0; }

        .coscene-projector-text { opacity: 1; }
        .coscene-laptop-text { fill: #ffffff; opacity: 1; }

        .coscene-walker { transform: translateX(0); }
        .coscene-arm { transform: rotate(65deg); transform-origin: 483px 206px; }
        .coscene-leg-left { transform-origin: 457.5px 243px; }
        .coscene-leg-right { transform-origin: 472.5px 243px; }
        .coscene-laptop-lid { fill: ${accent}; transform-origin: 576px 207px; transform: scaleY(1); }
        .coscene-projector { fill: #ffffff; stroke: ${accent}; stroke-width: 5; }
        .coscene-audience { opacity: 1; transform: translateY(0); }

        .coscene-pre .coscene-walker { transform: translateX(-500px); }
        .coscene-pre .coscene-arm { transform: rotate(65deg); }
        .coscene-pre .coscene-leg-left,
        .coscene-pre .coscene-leg-right { transform: rotate(0deg); }
        .coscene-pre .coscene-laptop-lid { fill: #4b5563; transform: scaleY(0.05); }
        .coscene-pre .coscene-projector { fill: #c7cfdd; stroke: transparent; }
        .coscene-pre .coscene-audience { opacity: 0; transform: translateY(6px); }
        .coscene-pre .coscene-laptop-text,
        .coscene-pre .coscene-projector-text { opacity: 0; }

        .coscene-playing .coscene-walker { animation: coscene-walk-in 2.4s ease-in-out forwards; }
        .coscene-playing .coscene-arm { animation: coscene-arm-reach 0.5s ease-out 2.4s forwards; }
        .coscene-playing .coscene-leg-left { animation: coscene-leg-swing-l 2.4s ease-in-out forwards; }
        .coscene-playing .coscene-leg-right { animation: coscene-leg-swing-r 2.4s ease-in-out forwards; }
        .coscene-playing .coscene-laptop-lid {
          animation: coscene-lid-open 0.7s ease-out 2.9s forwards, coscene-lid-light 0.4s ease-out 3.6s forwards;
        }
        .coscene-playing .coscene-laptop-text { animation: coscene-fade-in 0.4s ease-out 3.7s forwards; }
        .coscene-playing .coscene-projector { animation: coscene-projector-on 0.5s ease-out 4.3s forwards; }
        .coscene-playing .coscene-projector-text { animation: coscene-fade-in 0.5s ease-out 4.5s forwards; }
        .coscene-playing .coscene-audience { animation: coscene-audience-fade 0.35s ease-out forwards; }

        .coscene-paused * { animation-play-state: paused !important; }

        @keyframes coscene-walk-in { from { transform: translateX(-500px); } to { transform: translateX(0); } }
        @keyframes coscene-arm-reach { from { transform: rotate(65deg); } to { transform: rotate(-35deg); } }
        @keyframes coscene-leg-swing-l {
          0% { transform: rotate(0deg); } 12% { transform: rotate(18deg); } 25% { transform: rotate(-18deg); }
          37% { transform: rotate(18deg); } 50% { transform: rotate(-18deg); } 62% { transform: rotate(18deg); }
          75% { transform: rotate(-18deg); } 87% { transform: rotate(10deg); } 100% { transform: rotate(0deg); }
        }
        @keyframes coscene-leg-swing-r {
          0% { transform: rotate(0deg); } 12% { transform: rotate(-18deg); } 25% { transform: rotate(18deg); }
          37% { transform: rotate(-18deg); } 50% { transform: rotate(18deg); } 62% { transform: rotate(-18deg); }
          75% { transform: rotate(18deg); } 87% { transform: rotate(-10deg); } 100% { transform: rotate(0deg); }
        }
        @keyframes coscene-lid-open { from { transform: scaleY(0.05); } to { transform: scaleY(1); } }
        @keyframes coscene-lid-light { from { fill: #4b5563; } to { fill: ${accent}; } }
        @keyframes coscene-projector-on { from { fill: #c7cfdd; stroke: transparent; } to { fill: #ffffff; stroke: ${accent}; } }
        @keyframes coscene-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes coscene-audience-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

        @media (prefers-reduced-motion: reduce) {
          .coscene-playing .coscene-walker,
          .coscene-playing .coscene-arm,
          .coscene-playing .coscene-leg-left,
          .coscene-playing .coscene-leg-right,
          .coscene-playing .coscene-laptop-lid,
          .coscene-playing .coscene-laptop-text,
          .coscene-playing .coscene-projector,
          .coscene-playing .coscene-projector-text,
          .coscene-playing .coscene-audience { animation: none !important; }
        }
      `}</style>

      <div
        ref={stageRef}
        className={`coscene-box ${stageClass}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <svg
          viewBox="0 0 680 380"
          role="img"
          aria-label={`Animated opening scene for ${title}`}
          aria-describedby={descId}
          key={runId}
        >
          <desc id={descId}>
            A speaker walks in, opens their laptop, and the projector screen and audience appear, welcoming visitors to{' '}
            {title}. {subtitle}
          </desc>

          <rect x="0" y="0" width="680" height="258" fill="#eef1f6" />
          <rect x="0" y="258" width="680" height="122" fill="#dbe1ec" />
          <rect x="0" y="256" width="680" height="3" fill="#c7cfdd" />

          <rect className="coscene-projector" x={SCREEN_X} y={SCREEN_Y} width={SCREEN_W} height={SCREEN_H} rx="4" />

          <rect x="480" y="222" width="170" height="38" rx="2" fill="#8b5e3c" />
          <rect x="480" y="222" width="170" height="8" rx="2" fill="#9c6b45" />

          {audience.map((i) => (
            <g key={i} className="coscene-audience" style={{ animationDelay: `${4.9 + i * 0.07}s` }}>
              <ellipse cx={40 + i * 45} cy="358" rx="16" ry="12" fill="#6b7384" />
              <circle cx={40 + i * 45} cy="338" r="10" fill="#6b7384" />
            </g>
          ))}

          <g className="coscene-walker">
            <path d="M450,185 a15,15 0 0 1 30,0 z" fill="#3a2a1d" />
            <circle cx="465" cy="188" r="15" fill="#e8b899" />
            <rect className="coscene-arm" x="479" y="206" width="8" height="30" rx="3" fill="#e8b899" />
            <rect x="449" y="203" width="32" height="40" rx="6" fill={accent} />
            <rect className="coscene-leg-left" x="453" y="243" width="9" height="20" rx="2" fill="#1f2937" />
            <rect className="coscene-leg-right" x="468" y="243" width="9" height="20" rx="2" fill="#1f2937" />
          </g>

          <rect className="coscene-laptop-base" x={LAPTOP_X} y="207" width="72" height="15" rx="2" fill="#374151" />
          <rect className="coscene-laptop-lid" x={LAPTOP_X} y={LAPTOP_Y} width={LAPTOP_W} height={LAPTOP_H} rx="3" />

          <text
            className="coscene-laptop-text"
            x={laptopCenterX}
            y={laptopCenterY}
            textAnchor="middle"
            dominantBaseline="central"
            fontWeight={600}
            fontSize={fit.laptopFontSize}
          >
            {fit.laptopText}
          </text>

          <text
            className="coscene-projector-text"
            x={screenCenterX}
            y={titleCenterY}
            textAnchor="middle"
            dominantBaseline="central"
            fontWeight={700}
            fontSize={fit.titleFontSize}
            fill="#172033"
          >
            {fit.titleText}
          </text>
          {fit.subtitleLines.length > 0 ? (
            <text
              className="coscene-projector-text"
              x={screenCenterX}
              y={subtitleBaselineY}
              textAnchor="middle"
              fontSize={subtitleFontSize}
              fill="#44506b"
            >
              {fit.subtitleLines.map((line, i) => (
                <tspan key={i} x={screenCenterX} dy={i === 0 ? '0' : '1.3em'}>
                  {line}
                </tspan>
              ))}
            </text>
          ) : null}

          {/* Off-canvas measuring node for getComputedTextLength() — never visible. */}
          <text ref={measureRef} x="-9999" y="-9999" aria-hidden="true" />
        </svg>
      </div>
    </div>
  )
}
