import { useEffect, useMemo, useState } from 'react'
import { X, Search, Download } from 'lucide-react'
import { useData } from '../context/DataContext'
import { displayValue, downloadCSV, fmtInt } from '../lib/format'

const BASE_COLUMNS = [
  { key: 'client_name', label: 'Client' },
  { key: 'lead_source', label: 'Lead Source' },
  { key: 'pipeline_stage', label: 'Stage' },
  { key: 'case_status', label: 'Status' },
  { key: 'admin', label: 'Admin' },
]

/** Slide-over showing the rows behind any KPI or chart segment. */
export default function DrilldownPanel() {
  const { drilldown, closeDrilldown } = useData()
  const [search, setSearch] = useState('')

  useEffect(() => {
    setSearch('')
  }, [drilldown])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closeDrilldown()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeDrilldown])

  const columns = useMemo(() => {
    if (!drilldown) return BASE_COLUMNS
    const extra = drilldown.extraColumns.filter(
      (c) => !BASE_COLUMNS.some((b) => b.key === c.key)
    )
    return [...BASE_COLUMNS, ...extra]
  }, [drilldown])

  const filtered = useMemo(() => {
    if (!drilldown) return []
    const q = search.trim().toLowerCase()
    if (!q) return drilldown.rows
    return drilldown.rows.filter((r) =>
      columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q))
    )
  }, [drilldown, search, columns])

  if (!drilldown) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25" onClick={closeDrilldown} />
      <div className="fixed inset-y-0 right-0 z-50 w-full lg:w-[65%] bg-card border-l border-line flex flex-col shadow-sm">
        <div className="px-5 py-4 border-b border-line flex items-center gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink truncate">{drilldown.title}</h2>
            <p className="text-xs text-muted mt-0.5">{fmtInt(filtered.length)} records</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => downloadCSV(filtered, columns, drilldown.title.replace(/[^\w]+/g, '_'))}
              className="inline-flex items-center gap-1.5 text-xs border border-line rounded-lg px-3 py-1.5 text-muted hover:text-ink hover:bg-page transition-colors"
            >
              <Download size={13} /> CSV
            </button>
            <button
              onClick={closeDrilldown}
              className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-page transition-colors"
              aria-label="Close panel"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="px-5 py-3 border-b border-line">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search records…"
              className="w-full text-sm border border-line rounded-lg pl-8 pr-3 py-2 bg-page/50 focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:bg-card"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-page text-left">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className="px-4 py-2.5 font-medium text-xs text-muted whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.opportunity_id || i} className="border-t border-line/70 hover:bg-page/60">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-2.5 whitespace-nowrap">
                      {c.render ? c.render(r) : displayValue(r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-10 text-center text-muted text-sm">
                    No matching records
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
