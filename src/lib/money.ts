/** "NPR 1,500" / "NPR 1,500.50" - Nepali digit grouping (1,00,000), no trailing ".00". */
export function formatMoney(amount: number | string, currency: string): string {
  const value = Number(amount)
  const text = Number.isFinite(value)
    ? value.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })
    : String(amount)
  return `${currency} ${text}`
}
