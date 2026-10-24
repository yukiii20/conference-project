import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Bug, HelpCircle, Lightbulb, MessageSquare, Send, type LucideIcon } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/authContext'
import { Alert, Button, Card, FormField, Icon, Input, Textarea } from '../ui'
import { Reveal } from './Reveal'

type Category = 'feature' | 'bug' | 'question' | 'other'

const CATEGORIES: Array<{ id: Category; label: string; icon: LucideIcon }> = [
  { id: 'feature', label: 'Feature', icon: Lightbulb },
  { id: 'bug', label: 'Bug', icon: Bug },
  { id: 'question', label: 'Question', icon: HelpCircle },
  { id: 'other', label: 'Other', icon: MessageSquare },
]

const MESSAGE_MIN = 10
const MESSAGE_MAX = 2000

/**
 * Home page "suggestion box": public feedback form, no login required. Logged
 * in visitors get name/email prefilled from their account (read-only-looking,
 * but still editable isn't needed — the account is the source of truth).
 * Submissions land in the Super admin "Suggestions" tab.
 */
export function SuggestionBox() {
  const { user, refresh } = useAuth()

  useEffect(() => {
    // Home page never otherwise checks the session — ask once so a logged-in
    // visitor's name/email can be prefilled below.
    refresh().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [category, setCategory] = useState<Category>('other')
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // honeypot — real visitors never see or fill this in
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (user) {
      setName(user.full_name)
      setEmail(user.email)
    }
  }, [user])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)

    const trimmed = message.trim()
    if (trimmed.length < MESSAGE_MIN) {
      setError(`Please write at least ${MESSAGE_MIN} characters.`)
      return
    }

    setSubmitting(true)
    try {
      await api.post('/suggestions', {
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        category,
        message: trimmed,
        page_url: window.location.pathname,
        website,
      })
      setSent(true)
      setMessage('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your suggestion. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      id="suggestions"
      className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6"
    >
      <Reveal>
        <div className="mx-auto max-w-[640px] text-center">
          <h2 className="text-2xl font-semibold sm:text-3xl">Help us improve</h2>
          <p className="mt-2 text-text-muted">
            Found a bug, want a feature, or just have a question? Tell us — we read every one.
          </p>
        </div>

        <Card className="mx-auto mt-8 max-w-[640px]">
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="font-medium text-text">Thanks — your suggestion has been sent.</p>
              <p className="text-sm text-text-muted">We read every suggestion that comes in.</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => setSent(false)}>
                Send another
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              {error ? (
                <div className="mb-4">
                  <Alert variant="danger">{error}</Alert>
                </div>
              ) : null}

              <fieldset>
                <legend className="mb-2 block text-sm font-medium text-text">Category</legend>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={category === c.id}
                      onClick={() => setCategory(c.id)}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                        category === c.id
                          ? 'border-brand bg-brand text-on-brand'
                          : 'border-border text-text-muted hover:bg-surface-muted'
                      }`}
                    >
                      <Icon icon={c.icon} size={16} />
                      {c.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="mt-4">
                <FormField label="Your message" htmlFor="suggestion-message" required>
                  <Textarea
                    id="suggestion-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
                    rows={4}
                    maxLength={MESSAGE_MAX}
                    required
                    minLength={MESSAGE_MIN}
                    placeholder="What should we build, fix, or explain better?"
                  />
                  <p className="mt-1 text-right text-xs text-text-muted">
                    {message.length}/{MESSAGE_MAX}
                  </p>
                </FormField>
              </div>

              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <FormField label="Name (optional)" htmlFor="suggestion-name">
                  <Input
                    id="suggestion-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={Boolean(user)}
                    maxLength={120}
                    placeholder="Jamie Rivera"
                    autoComplete="name"
                  />
                </FormField>
                <FormField label="Email (optional)" htmlFor="suggestion-email">
                  <Input
                    id="suggestion-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={Boolean(user)}
                    maxLength={254}
                    placeholder="jamie@example.com"
                    autoComplete="email"
                  />
                </FormField>
              </div>

              {/* Honeypot: hidden from sighted users and screen readers, but still a normal
                  form field a scripted bot will often fill in blindly. Any non-empty value
                  here makes the backend silently drop the submission. */}
              <div className="sr-only" aria-hidden="true">
                <label htmlFor="suggestion-website">Website</label>
                <input
                  id="suggestion-website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              <Button
                type="submit"
                className="mt-5"
                loading={submitting}
                iconRight={<Icon icon={Send} size={16} />}
              >
                Send
              </Button>
            </form>
          )}
        </Card>
      </Reveal>
    </section>
  )
}
