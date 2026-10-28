/**
 * Chart colour tokens for the Analytics tabs — the dataviz skill's palette
 * parameters, filled in with its validated default instance (re-validated
 * against this app's actual chart surface, #fffdf9 — see docs/progress.md
 * for the validator run). This app has no dark mode, so these are the only
 * values needed; swap them here (not per-chart) if the brand palette ever
 * changes.
 */

/** Single hue, light -> dark — the default for any magnitude/trend chart (one series). */
export const SEQUENTIAL_BLUE = {
  100: '#cde2fb',
  300: '#6da7ec',
  500: '#256abf',
  700: '#0d366b',
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

export const CHART_INK = {
  primary: '#2b2420',
  secondary: '#6b5e52',
  muted: '#8a7f73',
  grid: '#e3d9c9',
  baseline: '#b7a89a',
  surface: '#fffdf9',
}
