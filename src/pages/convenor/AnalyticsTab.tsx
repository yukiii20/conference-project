import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api, ApiError } from '../../lib/api'
import { formatKathmandu } from '../../lib/datetime'
import { PageHeader, Alert, Button, Input, LinkButton, Spinner } from '../../components/ui'
import {
  ChartCard,
  MagnitudeBar,
  RateMeter,
  SimpleTable,
  StatTile,
  TrendLine,
} from '../../components/analytics/ChartPrimitives'

type NamedCount = { name: string; count: number }
type DailyPoint = { date: string; count: number }
type RateStat = { numerator: number; denominator: number; rate: number }

type ConvenorAnalytics = {
  range: { from: string; to: string }
  submissions_per_day: DailyPoint[]
  submissions_per_track: NamedCount[]
  acceptance_rate: RateStat
  review_progress: { assigned: number; submitted: number; overdue: number }
  avg_review_score_per_track: Array<{ name: string; avg_score: number | null }>
  registrations_over_time: DailyPoint[]
  registrations_by_category: NamedCount[]
  checkins_per_hour: Array<{ hour: number; count: number }>
  attendance_rate: RateStat
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

export function AnalyticsTab({ conferenceId }: { conferenceId: string }) {
  const [from, setFrom] = useState(daysAgoIso(30))
  const [to, setTo] = useState(todayIso())
  const [data, setData] = useState<ConvenorAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.get<ConvenorAnalytics>(`/conferences/${conferenceId}/analytics`, { from, to })
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load analytics.')
    } finally {
      setLoading(false)
    }
  }, [conferenceId, from, to])

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
      <PageHeader title="Analytics" subtitle="Submissions, reviews, registrations, and attendance for this conference." />
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
          <LinkButton href={`${API_BASE}/conferences/${conferenceId}/analytics/report.pdf?${exportQuery}`} variant="secondary" size="sm">
            Download PDF report
          </LinkButton>
          <LinkButton href={`${API_BASE}/conferences/${conferenceId}/analytics/report.xlsx?${exportQuery}`} variant="secondary" size="sm">
            Download Excel
          </LinkButton>
        </div>
      </div>

      {data ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label="Reviews assigned" value={String(data.review_progress.assigned)} />
            <StatTile label="Reviews submitted" value={String(data.review_progress.submitted)} />
            <StatTile label="Reviews overdue" value={String(data.review_progress.overdue)} tone={data.review_progress.overdue > 0 ? 'critical' : 'default'} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RateMeter label="Acceptance rate (decided abstracts)" {...data.acceptance_rate} />
            <RateMeter label="Attendance rate (confirmed who checked in)" {...data.attendance_rate} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="Submissions per day"
              subtitle={`${from} – ${to}`}
              empty={data.submissions_per_day.every((p) => p.count === 0)}
              table={<SimpleTable columns={['Date', 'Submissions']} rows={data.submissions_per_day.map((p) => [formatKathmandu(p.date, { dateOnly: true }), p.count])} />}
            >
              <TrendLine data={data.submissions_per_day} xKey="date" yKey="count" yLabel="Submissions" />
            </ChartCard>

            <ChartCard
              title="Registrations over time"
              subtitle={`${from} – ${to}`}
              empty={data.registrations_over_time.every((p) => p.count === 0)}
              table={<SimpleTable columns={['Date', 'Registrations']} rows={data.registrations_over_time.map((p) => [formatKathmandu(p.date, { dateOnly: true }), p.count])} />}
            >
              <TrendLine data={data.registrations_over_time} xKey="date" yKey="count" yLabel="Registrations" />
            </ChartCard>

            <ChartCard
              title="Submissions per track"
              empty={data.submissions_per_track.length === 0}
              table={<SimpleTable columns={['Track', 'Submissions']} rows={data.submissions_per_track.map((p) => [p.name, p.count])} />}
            >
              <MagnitudeBar data={data.submissions_per_track} xKey="name" yKey="count" yLabel="Submissions" />
            </ChartCard>

            <ChartCard
              title="Average review score per track"
              subtitle="1–5 scale, submitted reviews only"
              empty={data.avg_review_score_per_track.every((p) => p.avg_score === null)}
              table={
                <SimpleTable
                  columns={['Track', 'Average score']}
                  rows={data.avg_review_score_per_track.map((p) => [p.name, p.avg_score === null ? '—' : p.avg_score.toFixed(2)])}
                />
              }
            >
              <MagnitudeBar
                data={data.avg_review_score_per_track.map((p) => ({ name: p.name, count: p.avg_score ?? 0 }))}
                xKey="name"
                yKey="count"
                yLabel="Average score"
              />
            </ChartCard>

            <ChartCard
              title="Registrations by category"
              empty={data.registrations_by_category.length === 0}
              table={<SimpleTable columns={['Category', 'Registrations']} rows={data.registrations_by_category.map((p) => [p.name, p.count])} />}
            >
              <MagnitudeBar data={data.registrations_by_category} xKey="name" yKey="count" yLabel="Registrations" />
            </ChartCard>

            <ChartCard
              title="Check-ins per hour"
              subtitle="On event days, conference local time"
              empty={data.checkins_per_hour.every((p) => p.count === 0)}
              table={<SimpleTable columns={['Hour', 'Check-ins']} rows={data.checkins_per_hour.map((p) => [`${String(p.hour).padStart(2, '0')}:00`, p.count])} />}
            >
              <MagnitudeBar
                data={data.checkins_per_hour.map((p) => ({ name: `${String(p.hour).padStart(2, '0')}:00`, count: p.count }))}
                xKey="name"
                yKey="count"
                yLabel="Check-ins"
              />
            </ChartCard>
          </div>
        </>
      ) : null}
    </div>
  )
}

export default AnalyticsTab
