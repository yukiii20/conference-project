/**
 * One CSV cell, always quoted. Text that a spreadsheet would run as a formula (starting with
 * =, +, -, @, tab or carriage return) gets a leading apostrophe, so a paper title or a public
 * suggestion like `=HYPERLINK(...)` opens as plain text in Excel / Sheets (CSV injection).
 * Only text values are prefixed; numbers such as -5 stay numbers.
 */
export function csvCell(value: unknown): string {
  let text: string
  if (value === null || value === undefined) text = ''
  else if (value instanceof Date) text = value.toISOString()
  else if (typeof value === 'string') text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') text = String(value)
  else text = JSON.stringify(value)
  return `"${text.replace(/"/g, '""')}"`
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',')
}
