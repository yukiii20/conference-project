import { ChartCard, SimpleTable, TrendLine } from '../../../components/analytics/ChartPrimitives'
import type { ConvenorAnalytics } from './types'

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/**
 * The dashboard's two activity charts, from the same
 * /analytics endpoint the Analytics tab uses (last 30 days). Lazy-loaded by
 * DashboardTab so Recharts stays out of the portal's first download.
 */
export default function DashboardCharts({ analytics }: { analytics: ConvenorAnalytics }) {
  const submissions = analytics.submissions_per_day.map((p) => ({ day: shortDate(p.date), count: p.count }))
  const registrations = analytics.registrations_over_time.map((p) => ({ day: shortDate(p.date), count: p.count }))
  const anySubmissions = submissions.some((p) => p.count > 0)
  const anyRegistrations = registrations.some((p) => p.count > 0)

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ChartCard
        title="New submissions"
        subtitle="Per day, last 30 days"
        empty={!anySubmissions}
        table={<SimpleTable columns={['Day', 'Submissions']} rows={submissions.map((p) => [p.day, p.count])} />}
      >
        <TrendLine data={submissions} xKey="day" yKey="count" yLabel="Submissions" />
      </ChartCard>
      <ChartCard
        title="New registrations"
        subtitle="Per day, last 30 days"
        empty={!anyRegistrations}
        table={<SimpleTable columns={['Day', 'Registrations']} rows={registrations.map((p) => [p.day, p.count])} />}
      >
        <TrendLine data={registrations} xKey="day" yKey="count" yLabel="Registrations" />
      </ChartCard>
    </div>
  )
}
