// Opens a clean, printable copy of a list in a new tab and brings up the browser's print dialog (print or save as
// PDF). Rows can carry a colour band (pink / amber / green), printed as a coloured stripe and tinted cell so the
// colours survive a black and white printer too (the band name is printed in words alongside).
const BAND_STYLE = {
  pink: { bg: '#FCE7EF', fg: '#B0124F', bar: '#D6246E' },
  amber: { bg: '#FEF3C7', fg: '#92400E', bar: '#D97706' },
  green: { bg: '#E8F3E1', fg: '#3F6E22', bar: '#6DA544' },
}

export function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function printableHtml({ title, subtitle = '', legend = [], columns, rows, band, groupBy }) {
  const head = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')
  let lastGroup = null
  const body = rows
    .map((r) => {
      let groupRow = ''
      if (groupBy) {
        const g = groupBy(r)
        if (g !== lastGroup) {
          lastGroup = g
          groupRow = `<tr class="group"><td colspan="${columns.length}">${escapeHtml(g)}</td></tr>`
        }
      }
      const b = band ? BAND_STYLE[band(r)] : null
      const cells = columns
        .map((c, i) => {
          const style = b && c.banded ? ` style="background:${b.bg};color:${b.fg};font-weight:600"` : ''
          const stripe = b && i === 0 ? ` style="border-left:6px solid ${b.bar}"` : ''
          return `<td${style || stripe}>${escapeHtml(c.value(r))}</td>`
        })
        .join('')
      return `${groupRow}<tr>${cells}</tr>`
    })
    .join('')
  const key = legend
    .map((l) => {
      const s = BAND_STYLE[l.band]
      return `<span class="key" style="background:${s.bg};color:${s.fg};border-left:6px solid ${s.bar}">${escapeHtml(l.label)}</span>`
    })
    .join('')
  const printed = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #1F2937; margin: 24px; font-size: 11px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #6B7280; margin: 0 0 10px; }
  .legend { margin: 0 0 12px; display: flex; gap: 8px; flex-wrap: wrap; }
  .key { padding: 3px 8px; border-radius: 3px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; background: #F3F4F6; border-bottom: 2px solid #D1D5DB; padding: 6px; }
  td { border-bottom: 1px solid #E5E7EB; padding: 5px 6px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  tr.group td { background: #1F2937; color: #fff; font-weight: 700; padding: 6px; }
  thead { display: table-header-group; }
  .foot { margin-top: 10px; color: #6B7280; }
  @page { size: A4 landscape; margin: 12mm; }
  @media print { body { margin: 0; } }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p class="sub">${escapeHtml(subtitle)}${subtitle ? ' · ' : ''}${rows.length} rows · printed ${escapeHtml(printed)}</p>
${key ? `<div class="legend">${key}</div>` : ''}
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<p class="foot">Asset Harbour reporting dashboard. Only as complete as the dates held in GHL.</p>
</body></html>`
}

export function printList(opts) {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open()
  w.document.write(printableHtml(opts))
  w.document.close()
  w.focus()
  // give the new tab a moment to lay out before the print dialog opens
  setTimeout(() => w.print(), 300)
  return true
}
