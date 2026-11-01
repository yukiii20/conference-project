import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/authContext'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  ErrorState,
  FormField,
  Icon,
  Input,
  SkeletonText,
  Textarea,
} from '../../components/ui'
import { type FaqItem, type PlatformSettings } from './shared'

export function PlatformSettingsTab() {
  const { isSuperAdmin } = useAuth()
  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await api.get<{ settings: PlatformSettings }>('/admin/platform-settings')
        if (!cancelled) {
          setSettings(data.settings)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load platform settings.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  function update<K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
    setSaved(false)
  }

  function updateFaq(index: number, field: keyof FaqItem, value: string) {
    setSettings((prev) => {
      if (!prev) return prev
      const faq_items = prev.faq_items.map((item, i) => (i === index ? { ...item, [field]: value } : item))
      return { ...prev, faq_items }
    })
    setSaved(false)
  }

  function addFaqItem() {
    setSettings((prev) => (prev ? { ...prev, faq_items: [...prev.faq_items, { q: '', a: '' }] } : prev))
  }

  function removeFaqItem(index: number) {
    setSettings((prev) => (prev ? { ...prev, faq_items: prev.faq_items.filter((_, i) => i !== index) } : prev))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!settings) return
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const data = await api.patch<{ settings: PlatformSettings }>('/admin/platform-settings', settings)
      setSettings(data.settings)
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save platform settings.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mt-6">
        <SkeletonText lines={6} />
      </div>
    )
  }
  if (error && !settings) {
    return (
      <div className="mt-6">
        <ErrorState message={error} />
      </div>
    )
  }
  if (!settings) return null

  return (
    <form onSubmit={handleSave} className="mt-6 max-w-2xl space-y-5">
      {!isSuperAdmin ? <Alert variant="info">Only a super administrator can change platform settings.</Alert> : null}
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {saved ? <Alert variant="success">Saved.</Alert> : null}

      <FormField label="Platform name" htmlFor="ps-name">
        <Input id="ps-name" value={settings.platform_name} onChange={(e) => update('platform_name', e.target.value)} required />
      </FormField>

      <FormField label="Support email" htmlFor="ps-support-email">
        <Input
          id="ps-support-email"
          type="email"
          value={settings.support_email ?? ''}
          onChange={(e) => update('support_email', e.target.value || null)}
        />
      </FormField>

      <Checkbox
        id="ps-notify-suggestions"
        label="Notify admins of new suggestions by email"
        checked={settings.notify_admins_of_suggestions}
        onChange={(e) => update('notify_admins_of_suggestions', e.target.checked)}
      />

      <FormField label="Footer text" htmlFor="ps-footer">
        <Textarea
          id="ps-footer"
          value={settings.footer_text ?? ''}
          onChange={(e) => update('footer_text', e.target.value || null)}
          rows={2}
        />
      </FormField>

      <FormField label="Home hero heading" htmlFor="ps-hero-headline">
        <Input
          id="ps-hero-headline"
          value={settings.hero_headline ?? ''}
          onChange={(e) => update('hero_headline', e.target.value || null)}
        />
      </FormField>

      <FormField label="Home hero subtext" htmlFor="ps-hero-subheadline">
        <Textarea
          id="ps-hero-subheadline"
          value={settings.hero_subheadline ?? ''}
          onChange={(e) => update('hero_subheadline', e.target.value || null)}
          rows={2}
        />
      </FormField>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text">FAQ items</p>
          <Button variant="secondary" size="sm" type="button" onClick={addFaqItem}>
            Add question
          </Button>
        </div>
        <div className="mt-2 space-y-3">
          {settings.faq_items.map((item, i) => (
            <Card key={i}>
              <div className="flex items-start justify-between gap-2">
                <label htmlFor={`faq-q-${i}`} className="sr-only">
                  Question {i + 1}
                </label>
                <Input
                  id={`faq-q-${i}`}
                  value={item.q}
                  onChange={(e) => updateFaq(i, 'q', e.target.value)}
                  placeholder="Question"
                  className="flex-1"
                />
                <Button variant="secondary" size="sm" type="button" onClick={() => removeFaqItem(i)}>
                  Remove
                </Button>
              </div>
              <label htmlFor={`faq-a-${i}`} className="sr-only">
                Answer {i + 1}
              </label>
              <Textarea
                id={`faq-a-${i}`}
                value={item.a}
                onChange={(e) => updateFaq(i, 'a', e.target.value)}
                placeholder="Answer"
                rows={2}
                className="mt-2"
              />
            </Card>
          ))}
        </div>
      </div>

      <Button type="submit" loading={saving} disabled={!isSuperAdmin} iconLeft={<Icon icon={Save} size={16} />}>
        Save settings
      </Button>
    </form>
  )
}
