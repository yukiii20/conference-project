import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Reveal } from '../Reveal'

const STEPS = [
  { title: 'Discover a conference', body: 'Browse open calls, read the tracks and key dates, and create one account that works for every conference here.' },
  { title: 'Submit your research', body: 'Write or upload your abstract, add co-authors and submit. You get a submission code and can track every change.' },
  { title: 'Complete peer review', body: 'Reviewers assess your work double-blind — they see the research, never your name or affiliation.' },
  { title: 'Receive an editorial decision', body: 'Accepted, revisions requested or declined — with reviewer comments, emailed and kept in your portal.' },
  { title: 'Attend and present', body: 'Register for your ticket, find your session in the published programme and check in with a QR code.' },
  { title: 'Receive your certificate', body: 'Download a PDF certificate once it is released, with a public link anyone can use to verify it.' },
]

/** 0 → 1 as the element scrolls through the middle of the viewport. */
function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setProgress(1)
      return
    }
    let frame = 0
    const update = () => {
      frame = 0
      const rect = el.getBoundingClientRect()
      const mid = window.innerHeight * 0.6
      setProgress(Math.max(0, Math.min(1, (mid - rect.top) / rect.height)))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  return [ref, progress] as const
}

export function JourneyTimeline() {
  const [listRef, progress] = useScrollProgress<HTMLOListElement>()
  const reached = Math.floor(progress * STEPS.length + 0.35)

  return (
    <div className="mx-auto grid max-w-[1240px] gap-14 px-4 py-24 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20 lg:py-32">
      <div className="lg:sticky lg:top-28 lg:self-start">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-ink">How it works</p>
          <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.015em] text-brand sm:text-5xl">From first abstract to final certificate.</h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-text-muted">
            Six stages, one account. Everything you submit, every decision and every document stays in your portal.
          </p>
          <Link
            to="/signup"
            className="group mt-8 inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3.5 text-[15px] font-medium text-on-brand transition hover:bg-brand-hover"
          >
            Create your account
            <ArrowRight size={18} aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </Reveal>
        <Reveal variant="image" delay={120} className="mt-12 hidden lg:block">
          <figure className="relative overflow-hidden rounded-[24px]">
            <img
              src="/images/home/stage-presentation-800.webp"
              srcSet="/images/home/stage-presentation-800.webp 800w, /images/home/stage-presentation-1600.webp 1600w"
              sizes="480px"
              width={800}
              height={572}
              loading="lazy"
              decoding="async"
              alt="A presenter on stage in front of a large audience"
              className="aspect-[16/10] w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-brand/50 to-transparent" aria-hidden="true" />
          </figure>
        </Reveal>
      </div>

      <ol ref={listRef} className="relative">
        {/* Track + scroll-linked progress */}
        <span className="absolute bottom-6 left-[27px] top-6 w-px bg-border" aria-hidden="true" />
        <span
          className="absolute left-[27px] top-6 w-px origin-top bg-gradient-to-b from-gold-ink to-indigo transition-transform duration-150"
          style={{ bottom: '1.5rem', transform: `scaleY(${progress})` }}
          aria-hidden="true"
        />
        {STEPS.map((step, i) => {
          const done = i < reached
          return (
            <li key={step.title} className="relative pb-12 pl-20 last:pb-0">
              <span
                className={`absolute left-0 top-0 flex h-14 w-14 items-center justify-center rounded-full border font-display text-xl font-semibold transition-all duration-500 ${
                  done ? 'border-brand bg-brand text-white shadow-[0_10px_24px_-10px_rgb(16_28_50/0.6)]' : 'border-border bg-surface text-text-muted'
                }`}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <Reveal delay={60}>
                <h3 className="pt-3 font-display text-2xl font-semibold text-text">{step.title}</h3>
                <p className="mt-2 max-w-lg leading-relaxed text-text-muted">{step.body}</p>
              </Reveal>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
