import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api, ApiError } from '../lib/api'
import { formatKathmandu } from '../lib/datetime'
import { PageHeader, Alert, Button, Input, LinkButton, Spinner } from './ui'
import { ChartCard, MagnitudeBar, SimpleTable, TrendLine, TwoSeriesBar } from './analytics/ChartPrimitives'

type NamedCount = { name: string; count: number }
type DailyPoint = { date: string; count: number }
type EmailDayPoint = { date: string; sent: number; failed: number }
type WeekPoint = { week_start: string; count: number }

type PlatformAnalytics = {
  range: { from: string; to: string }
  conferences_by_status: NamedCount[]
  users_over_time: DailyPoint[]
  emails_per_day: EmailDayPoint[]
  suggestions_per_week: WeekPoint[]
}

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
function daysAgoIso(days: number): string {
  return new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
}

export function PlatformAnalyticsTab() {
  const [from, setFrom] = useState(daysAgoIso(30))
  const [to, setTo] = useState(todayIso())
  const [data, setData] = useState<PlatformAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.get<PlatformAnalytics>('/admin/analytics', { from, to })
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load analytics.')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])

  const exportQuery = `from=${from}&to=${to}`

  if (loading && !data) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Spinner size="sm" /> Loading…
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-6">
      <PageHeader title="Analytics" subtitle="Platform-wide numbers across every conference." />
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setFrom(daysAgoIso(p.days))
              setTo(todayIso())
            }}
          >
            {p.label}
          </Button>
        ))}
        <label className="ml-2 text-xs text-text-muted">
          From
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 w-auto" />
        </label>
        <label className="text-xs text-text-muted">
          To
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 w-auto" />
        </label>
        <div className="ml-auto flex gap-2">
          <LinkButton href={`${API_BASE}/admin/analytics/report.pdf?${exportQuery}`} variant="secondary" size="sm">
            Download PDF report
          </LinkButton>
          <LinkButton href={`${API_BASE}/admin/analytics/report.xlsx?${exportQuery}`} variant="secondary" size="sm">
            Download Excel
          </LinkButton>
        </div>
      </div>

      {data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title="Conferences by status"
            empty={data.conferences_by_status.length === 0}
            table={<SimpleTable columns={['Status', 'Conferences']} rows={data.conferences_by_status.map((p) => [p.name, p.count])} />}
          >
            <MagnitudeBar data={data.conferences_by_status} xKey="name" yKey="count" yLabel="Conferences" />
          </ChartCard>

          <ChartCard
            title="New users over time"
            subtitle={`${from} – ${to}`}
            empty={data.users_over_time.every((p) => p.count === 0)}
            table={<SimpleTable columns={['Date', 'New users']} rows={data.users_over_time.map((p) => [formatKathmandu(p.date, { dateOnly: true }), p.count])} />}
          >
            <TrendLine data={data.users_over_time} xKey="date" yKey="count" yLabel="New users" />
          </ChartCard>

          <ChartCard
            title="Emails sent / failed per day"
            subtitle={`${from} – ${to}`}
            empty={data.emails_per_day.every((p) => p.sent === 0 && p.failed === 0)}
            table={<SimpleTable columns={['Date', 'Sent', 'Failed']} rows={data.emails_per_day.map((p) => [formatKathmandu(p.date, { dateOnly: true }), p.sent, p.failed])} />}
          >
            <TwoSeriesBar data={data.emails_per_day} xKey="date" aKey="sent" aLabel="Sent" bKey="failed" bLabel="Failed" />
          </ChartCard>

          <ChartCard
            title="Suggestions per week"
            empty={data.suggestions_per_week.length === 0}
            table={<SimpleTable columns={['Week of', 'Suggestions']} rows={data.suggestions_per_week.map((p) => [formatKathmandu(p.week_start, { dateOnly: true }), p.count])} />}
          >
            <MagnitudeBar
              data={data.suggestions_per_week.map((p) => ({ name: formatKathmandu(p.week_start, { dateOnly: true }), count: p.count }))}
              xKey="name"
              yKey="count"
              yLabel="Suggestions"
            />
          </ChartCard>
        </div>
      ) : null}
    </div>
  )
}

export default PlatformAnalyticsTab
