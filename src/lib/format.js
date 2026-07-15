// Formatting helpers — every displayed number goes through one of these
// so blanks render as "—", never 0/NaN/undefined.

export const DASH = '—'

export function num(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

export function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === ''
}

export function parseBool(v) {
  return String(v).trim().toLowerCase() === 'true'
}

export function fmtInt(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return DASH
  return Number(n).toLocaleString('en-GB')
}

export function fmtPct(numerator, denominator) {
  if (!denominator || !Number.isFinite(numerator)) return DASH
  return ((numerator / denominator) * 100).toFixed(1) + '%'
}

export function fmtDays(v) {
  if (isBlank(v) || !Number.isFinite(Number(v))) return DASH
  return Number(v).toFixed(1)
}

// £ + thousands separator. Whole-pound amounts show no decimals (the
// common case for these fee fields); only amounts with actual pence show
// 2 decimals, so typical entries don't get a noisy ".00" suffix.
export function fmtCurrency(v) {
  if (isBlank(v) || !Number.isFinite(Number(v))) return DASH
  const n = Number(v)
  const decimals = Number.isInteger(n) ? 0 : 2
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function parseDate(s) {
  if (isBlank(s)) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export function fmtDate(s) {
  const d = s instanceof Date ? s : parseDate(s)
  if (!d) return DASH
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function daysBetween(a, b) {
  return (b.getTime() - a.getTime()) / 86400000
}

export function relTime(iso) {
  const d = parseDate(iso)
  if (!d) return DASH
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

export function displayValue(v) {
  return isBlank(v) ? DASH : String(v)
}

export function toCSV(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const header = columns.map((c) => esc(c.label)).join(',')
  const body = rows
    .map((r) => columns.map((c) => esc(c.render ? c.rawForCsv?.(r) ?? r[c.key] : r[c.key])).join(','))
    .join('\n')
  return header + '\n' + body
}

export function downloadCSV(rows, columns, filename) {
  const blob = new Blob([toCSV(rows, columns)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
