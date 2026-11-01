import { useEffect, useState, type ReactNode } from 'react'
import {
  AlertOctagon,
  Building2,
  Database,
  FileStack,
  HardDrive,
  Mail,
  MessageSquare,
  Ticket,
  UserCheck,
  UserX,
  type LucideIcon,
} from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { humanizeAuditAction } from '../../lib/humanize'
import {
  Badge,
  EmptyState,
  ErrorState,
  Panel,
  StatCard,
  Icon,
  SkeletonText,
  StatusChip,
} from '../../components/ui'
import { formatBytes, formatDateTime, formatStatus, type DashboardData } from './shared'

export function DashboardTab({
  newSuggestionsCount,
  onViewSuggestions,
}: {
  newSuggestionsCount: number
  onViewSuggestions: () => void
}) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await api.get<DashboardData>('/admin/dashboard')
        if (!cancelled) {
          setData(res)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="mt-6">
        <ErrorState message={error} />
      </div>
    )
  }
  if (!data) {
    return (
      <div className="mt-6">
        <SkeletonText lines={5} />
      </div>
    )
  }

  const tiles: Array<{ label: string; value: number; icon: LucideIcon }> = [
    { label: 'Total users', value: data.total_users, icon: UserCheck },
    { label: 'Suspended users', value: data.suspended_users, icon: UserX },
    { label: 'Pending role requests', value: data.pending_role_requests, icon: AlertOctagon },
    { label: 'Total submissions', value: data.total_submissions, icon: FileStack },
    { label: 'Active registrations', value: data.active_registrations, icon: Ticket },
    { label: 'Archived conferences', value: data.archived_conferences, icon: Building2 },
  ]

  const health = data.health
  const healthRows: Array<{ label: string; icon: LucideIcon; value: ReactNode }> = [
    {
      label: 'Database',
      icon: Database,
      value: <Badge tone={health.database.ok ? 'success' : 'danger'}>{health.database.ok ? `${health.database.latency_ms} ms` : 'Down'}</Badge>,
    },
    { label: 'Email mode', icon: Mail, value: <span className="font-medium uppercase tracking-wide">{health.email_mode}</span> },
    {
      label: 'Failed emails (24h)',
      icon: AlertOctagon,
      value: <Badge tone={health.failed_emails_24h > 0 ? 'danger' : 'neutral'}>{health.failed_emails_24h}</Badge>,
    },
    { label: 'Queued emails', icon: Mail, value: <span className="font-medium tabular-nums">{health.queued_emails}</span> },
    { label: 'Free disk space', icon: HardDrive, value: <span className="font-medium tabular-nums">{formatBytes(health.storage_disk.free_bytes)}</span> },
  ]
  const allHealthy = health.database.ok && health.failed_emails_24h === 0

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {tiles.map((t) => (
          <StatCard key={t.label} label={t.label} value={t.value} icon={t.icon} />
        ))}
        <button type="button" onClick={onViewSuggestions} className="group block h-full rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-button">
          <StatCard label="New suggestions" value={newSuggestionsCount} icon={MessageSquare} hint="Open the inbox →" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel title="Conferences by status">
            {data.conferences_by_status.length === 0 ? (
              <EmptyState
                title="No conferences yet."
                message="Create the first one from the Conferences tab."
                icon={<Icon icon={Building2} size={28} />}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.conferences_by_status.map((s) => (
                  <span key={s.status} className="inline-flex items-center gap-2 rounded-lg border border-border-soft bg-page-bg px-3 py-1.5 text-sm">
                    <StatusChip status={s.status} labels={{ [s.status]: formatStatus(s.status) }} />
                    <span className="font-semibold tabular-nums text-text">{s.count}</span>
                  </span>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Recent activity">
            {data.recent_actions.length === 0 ? (
              <EmptyState title="No activity yet." message="Audited actions will show up here as they happen." />
            ) : (
              <ol className="relative space-y-4 border-l border-border-soft pl-5">
                {data.recent_actions.map((a) => (
                  <li key={a.id} className="relative text-sm">
                    <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-button" aria-hidden="true" />
                    <p className="text-text">
                      <span className="font-medium">{a.actor_name ?? 'System'}</span> {humanizeAuditAction(a.action)}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">{formatDateTime(a.occurred_at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <Panel
          title="System health"
          action={
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${allHealthy ? 'text-success' : 'text-danger'}`}>
              <span className={`h-2 w-2 rounded-full ${allHealthy ? 'bg-success' : 'bg-danger'}`} aria-hidden="true" />
              {allHealthy ? 'All systems normal' : 'Needs attention'}
            </span>
          }
        >
          <ul className="divide-y divide-border-soft">
            {healthRows.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex items-center gap-3 text-sm text-text-muted">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-page-bg text-text-muted">
                    <Icon icon={r.icon} size={16} />
                  </span>
                  {r.label}
                </span>
                <span className="text-sm text-text">{r.value}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
