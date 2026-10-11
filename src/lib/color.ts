export const DEFAULT_CONFERENCE_COLOR = '#2747A0'

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9A-Fa-f]{6})$/.exec(hex)
  if (!match) return null
  const int = parseInt(match[1], 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

function clampChannel(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => clampChannel(v).toString(16).padStart(2, '0')).join('')}`
}

/** Mix a hex color toward black by `amount` (0-1), e.g. for a darker overlay/band shade. */
export function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const [r, g, b] = rgb
  return rgbToHex([r * (1 - amount), g * (1 - amount), b * (1 - amount)])
}

/** Mix a hex color toward white by `amount` (0-1), e.g. for a lighter tint. */
export function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const [r, g, b] = rgb
  return rgbToHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount])
}

function channelLuminance(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

function contrastRatio(hexA: string, hexB: string): number {
  const rgbA = hexToRgb(hexA)
  const rgbB = hexToRgb(hexB)
  if (!rgbA || !rgbB) return 1
  const lA = relativeLuminance(rgbA) + 0.05
  const lB = relativeLuminance(rgbB) + 0.05
  return lA > lB ? lA / lB : lB / lA
}

/** WCAG: white text only if it reaches 4.5:1 against the background, otherwise dark text. */
export function getAccessibleTextColor(backgroundHex: string): '#ffffff' | '#172033' {
  return contrastRatio(backgroundHex, '#ffffff') >= 4.5 ? '#ffffff' : '#172033'
}

export function isValidHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value)
}

/** `#rrggbb` -> `rgba(r, g, b, alpha)`, e.g. for a translucent overlay over a banner image. */
export function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}
