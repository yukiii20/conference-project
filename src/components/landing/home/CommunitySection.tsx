import { EyeOff, Globe2, Mail, ShieldCheck, type LucideIcon } from 'lucide-react'
import { SITE } from '../../../content/site'
import { CountUp, Reveal } from '../Reveal'
import type { PublicStats } from './homeData'

const PILLAR_ICONS: LucideIcon[] = [EyeOff, ShieldCheck, Mail, Globe2]

function Photo({ name, alt, className, sizes }: { name: string; alt: string; className: string; sizes: string }) {
  return (
    <img
      src={`/images/home/${name}-800.webp`}
      srcSet={`/images/home/${name}-800.webp 800w, /images/home/${name}-1600.webp 1600w`}
      sizes={sizes}
      width={800}
      height={533}
      loading="lazy"
      decoding="async"
      alt={alt}
      className={`h-full w-full object-cover transition-transform duration-[1200ms] ease-out hover:scale-[1.04] ${className}`}
    />
  )
}

export function CommunitySection({ stats, tracks }: { stats: PublicStats | null; tracks: number | null }) {
  // Only real, non-zero numbers are shown; the band disappears if there's nothing to show.
  const figures = [
    { label: 'Research submissions', value: stats?.submissions ?? 0 },
    { label: 'Registered participants', value: stats?.registrations ?? 0 },
    { label: 'Research tracks', value: tracks ?? 0 },
    { label: stats?.countries === 1 ? 'Host country' : 'Host countries', value: stats?.countries ?? 0 },
  ].filter((f) => f.value > 0)

  return (
    <div className="relative overflow-hidden">
      <div className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:py-32">
        <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-20">
          <div>
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-ink">Academic community</p>
              <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.015em] text-brand sm:text-5xl">
                Bringing ideas, researchers and institutions together.
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-text-muted">
                Conferences are where research meets its audience. This platform takes care of the process around them — so organisers
                can focus on the programme, and researchers on their work.
              </p>
            </Reveal>
            <div className="mt-10 grid gap-6 sm:grid-cols-2">
              {SITE.whyPlatform.items.map((item, i) => {
                const Icon = PILLAR_ICONS[i] ?? ShieldCheck
                return (
                  <Reveal key={item.title} delay={i * 70}>
                    <div className="border-t border-border pt-5">
                      <Icon size={20} aria-hidden="true" className="text-indigo" />
                      <h3 className="mt-3 font-semibold text-text">{item.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{item.description}</p>
                    </div>
                  </Reveal>
                )
              })}
            </div>
          </div>

          {/* Editorial photo mosaic */}
          <div className="grid grid-cols-6 grid-rows-[repeat(6,minmax(0,1fr))] gap-3 sm:gap-4" style={{ aspectRatio: '1 / 1.02' }}>
            <Reveal variant="image" className="col-span-4 row-span-4 overflow-hidden rounded-[24px]">
              <Photo name="lecture-hall" sizes="(min-width: 1024px) 420px, 66vw" alt="Researchers attending a seminar in a lecture room" className="" />
            </Reveal>
            <Reveal variant="image" delay={120} className="col-span-2 row-span-3 overflow-hidden rounded-[24px]">
              <Photo name="laboratory" sizes="(min-width: 1024px) 220px, 33vw" alt="Laboratory glassware in a research lab" className="object-[30%_center]" />
            </Reveal>
            <Reveal variant="image" delay={200} className="col-span-2 row-span-3 overflow-hidden rounded-[24px]">
              <Photo name="campus" sizes="(min-width: 1024px) 220px, 33vw" alt="A university building across a green lawn" className="object-[45%_center]" />
            </Reveal>
            <Reveal variant="image" delay={280} className="col-span-4 row-span-2 overflow-hidden rounded-[24px]">
              <Photo name="collaboration" sizes="(min-width: 1024px) 420px, 66vw" alt="Three researchers discussing work around a laptop" className="object-[center_35%]" />
            </Reveal>
          </div>
        </div>

        {figures.length > 0 ? (
          <Reveal className="mt-20">
            <dl className={`grid gap-px overflow-hidden rounded-[24px] border border-border-soft bg-border-soft ${figures.length >= 4 ? 'grid-cols-2 lg:grid-cols-4' : figures.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
              {figures.map((f) => (
                <div key={f.label} className="flex flex-col-reverse bg-surface px-6 py-8 sm:px-8">
                  <dt className="mt-2 text-sm text-text-muted">{f.label}</dt>
                  <dd className="font-display text-4xl font-semibold text-brand sm:text-5xl">
                    <CountUp value={f.value} />
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-text-muted">Live totals across every published conference on the platform.</p>
          </Reveal>
        ) : null}
      </div>
    </div>
  )
}
