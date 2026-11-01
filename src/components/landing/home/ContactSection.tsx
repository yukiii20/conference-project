import { memo } from 'react'
import { ArrowRight, Mail, MapPin, MessageSquareText } from 'lucide-react'
import { SITE } from '../../../content/site'
import { Reveal } from '../Reveal'

export const ContactSection = memo(function ContactSection({ email, onFeedback }: { email: string; onFeedback: () => void }) {
  const gmailHref = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`
  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <Reveal>
        <div className="relative isolate overflow-hidden rounded-[32px] bg-brand text-white">
          <img
            src="/images/home/auditorium-1600.webp"
            srcSet="/images/home/auditorium-800.webp 800w, /images/home/auditorium-1600.webp 1600w"
            sizes="(min-width: 1240px) 1240px, 100vw"
            width={1600}
            height={1067}
            loading="lazy"
            decoding="async"
            alt=""
            className="absolute inset-0 -z-10 h-full w-full object-cover opacity-35"
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-brand via-brand/90 to-brand/40" aria-hidden="true" />

          <div className="grid gap-12 px-6 py-14 sm:px-12 sm:py-16 lg:grid-cols-[1.3fr_1fr] lg:items-center lg:px-16 lg:py-20">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Contact</p>
              <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.015em] sm:text-5xl">{SITE.contactBand.heading}</h2>
              <p className="mt-4 max-w-lg text-lg leading-relaxed text-white/75">{SITE.contactBand.description}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a
                  href={gmailHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-gold px-6 py-3.5 text-[15px] font-semibold text-brand transition duration-300 hover:bg-[#e6c993]"
                >
                  {SITE.contactBand.cta}
                  <ArrowRight size={18} aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1" />
                </a>
                <button
                  type="button"
                  onClick={onFeedback}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/25 px-6 py-3.5 text-[15px] font-medium text-white transition duration-300 hover:border-white/50 hover:bg-white/5"
                >
                  <MessageSquareText size={18} aria-hidden="true" />
                  Send feedback
                </button>
              </div>
            </div>

            <div className="space-y-6 rounded-[24px] border border-white/10 bg-white/[0.06] p-6 backdrop-blur-sm sm:p-8">
              <dl className="space-y-6">
              <div>
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/50">
                  <Mail size={14} aria-hidden="true" /> Email
                </dt>
                <dd className="mt-2">
                  <a href={`mailto:${email}`} className="break-all text-lg font-medium text-white underline-offset-4 hover:underline">
                    {email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/50">
                  <MapPin size={14} aria-hidden="true" /> Based in
                </dt>
                <dd className="mt-2 text-lg font-medium text-white">Banepa, Nepal</dd>
              </div>
              </dl>
              <p className="border-t border-white/10 pt-5 text-sm leading-relaxed text-white/60">
                Conferences are set up by our team. Send your conference's name, dates and contact person, and we'll create it and make you its convenor.
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  )
})
