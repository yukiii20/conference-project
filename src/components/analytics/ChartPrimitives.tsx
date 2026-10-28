import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART_INK, EMAIL_FAILED, EMAIL_SENT, SEQUENTIAL_BLUE } from '../../lib/chartTheme'
import { Button } from '../ui'

const TOOLTIP_STYLE = {
  background: CHART_INK.surface,
  border: `1px solid ${CHART_INK.baseline}`,
  borderRadius: 6,
  fontSize: 12,
  color: CHART_INK.primary,
}
const AXIS_TICK = { fill: CHART_INK.muted, fontSize: 11 }

/** Title + optional subtitle + a "View as table" toggle (the dataviz skill's accessibility requirement: a table view always exists) + empty state. Every chart below renders inside one of these. */
export function ChartCard({
  title,
  subtitle,
  empty,
  table,
  children,
}: {
  title: string
  subtitle?: string
  /** When true, the chart has no data worth drawing — render the empty state instead of an empty plot. */
  empty: boolean
  /** The same data as a plain table, shown when "View as table" is toggled on. */
  table: ReactNode
  children: ReactNode
}) {
  const [showTable, setShowTable] = useState(false)
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {subtitle ? <p className="text-xs text-text-muted">{subtitle}</p> : null}
        </div>
        {!empty ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'View chart' : 'View as table'}
          </Button>
        ) : null}
      </div>
      <div className="mt-3">
        {empty ? (
          <p className="rounded-md border border-dashed border-border bg-page-bg px-4 py-6 text-center text-sm text-text-muted">
            No data yet for this range.
          </p>
        ) : showTable ? (
          table
        ) : (
          children
        )}
      </div>
    </div>
  )
}

export function SimpleTable({ columns, rows }: { columns: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-2 py-1 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-1">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Trend over time, one series — sequential blue line with a light area wash underneath. */
export function TrendLine({ data, xKey, yKey, yLabel }: { data: Array<Record<string, string | number>>; xKey: string; yKey: string; yLabel: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeDasharray="0" />
        <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={{ stroke: CHART_INK.baseline }} tickLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v as number, yLabel]} />
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={SEQUENTIAL_BLUE[500]}
          strokeWidth={2}
          fill={SEQUENTIAL_BLUE[500]}
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 4, fill: SEQUENTIAL_BLUE[500], stroke: CHART_INK.surface, strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Compare magnitude across named categories, one measure — single sequential hue, never one color per bar (that's identity, not magnitude). */
export function MagnitudeBar({ data, xKey, yKey, yLabel }: { data: Array<Record<string, string | number | null>>; xKey: string; yKey: string; yLabel: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeDasharray="0" />
        <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={{ stroke: CHART_INK.baseline }} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v as number, yLabel]} cursor={{ fill: CHART_INK.grid }} />
        <Bar dataKey={yKey} fill={SEQUENTIAL_BLUE[500]} radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Two named series (e.g. sent vs failed) — validated categorical-vs-status pair, see lib/chartTheme.ts. */
export function TwoSeriesBar({
  data,
  xKey,
  aKey,
  aLabel,
  bKey,
  bLabel,
}: {
  data: Array<Record<string, string | number>>
  xKey: string
  aKey: string
  aLabel: string
  bKey: string
  bLabel: string
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeDasharray="0" />
        <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={{ stroke: CHART_INK.baseline }} tickLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 12, color: CHART_INK.secondary }} />
        <Bar dataKey={aKey} name={aLabel} fill={EMAIL_SENT} radius={[4, 4, 0, 0]} maxBarSize={16} />
        <Bar dataKey={bKey} name={bLabel} fill={EMAIL_FAILED} radius={[4, 4, 0, 0]} maxBarSize={16} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** A handful of headline numbers — stat tiles, not a bar chart (the dataviz skill's form rule). */
export function StatTile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'critical' }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === 'critical' ? 'text-danger' : 'text-text'}`}>{value}</p>
    </div>
  )
}

/** A single ratio against a limit — a meter, not a 2-slice pie. */
export function RateMeter({ label, numerator, denominator, rate }: { label: string; numerator: number; denominator: number; rate: number }) {
  const pct = Math.round(rate * 100)
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-text-muted">{label}</p>
        <p className="text-sm font-semibold text-text">{pct}%</p>
      </div>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full" style={{ background: SEQUENTIAL_BLUE[100] }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SEQUENTIAL_BLUE[500] }} />
      </div>
      <p className="mt-1 text-xs text-text-muted">
        {numerator} of {denominator}
      </p>
    </div>
  )
}
