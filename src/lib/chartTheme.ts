/**
 * Chart colour tokens for the Analytics tabs — the dataviz skill's palette
 * parameters, filled in with its validated default instance, re-validated
 * against the white card surface (#ffffff): the categorical set passes every
 * check; green/amber are under 3:1 contrast, so charts using them need a
 * legend and a table view (ChartCard always offers one). This app has no dark mode, so these are the only
 * values needed; swap them here (not per-chart) if the brand palette ever
 * changes.
 */

/**
 * Single hue, light -> dark — the default for any magnitude/trend chart (one
 * series). Built on the design system's indigo (#5969c9 / action #4f5fc0) and
 * midnight navy, so charts read as part of the product. The name is kept so
 * existing charts pick it up unchanged. 500 is the mark colour (5.2:1 on white).
 */
export const SEQUENTIAL_BLUE = {
  100: '#e3e6f8',
  300: '#9ca6e2',
  500: '#4f5fc0',
  700: '#26336f',
}

/** Fixed-order categorical slots — never cycle past what's validated; fold extra series into "Other". */
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const

/** Reserved for state, never reused as a categorical series colour. */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
}

/**
 * The one 2-series chart that needs a sent-vs-failed pairing (platform
 * emails per day). Deliberately NOT status.good + status.critical (green vs
 * red) — validated CVD ΔE 4.1 (deutan), well below the 6-8 floor the skill
 * requires even for a secondary-encoded pair. categorical[0] (blue) vs
 * status.critical (red) validates clean (ΔE 23.8 protan) and still reads as
 * "normal" vs "failed".
 */
export const EMAIL_SENT = CATEGORICAL[0]
export const EMAIL_FAILED = STATUS.critical

/** Chart text/axis/grid ink — the app's slate text tokens and border colours on the white card surface. */
export const CHART_INK = {
  primary: '#1e293b',
  secondary: '#475063',
  muted: '#5e6676',
  grid: '#ece9e2',
  baseline: '#a3a9b5',
  surface: '#ffffff',
}
