import { useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Search, Download } from 'lucide-react'
import { displayValue, downloadCSV, fmtInt } from '../lib/format'

/**
 * Sortable / searchable / filterable / paginated table with CSV export.
 * columns: [{ key, label, render?, sortValue?, sortable? }]
 * filters: [{ key, label, blankLabel?, group?, groupOrder?, markAnomalous?, allowedValues? }]
 *   — dropdowns normally built from distinct values in rows. Filters
 *   combine with AND. If blankLabel is set, an extra option is added
 *   (e.g. "(No advisor assigned)") that matches rows where the field is
 *   blank, rather than omitting them. If group(value) is set, options
 *   render as <optgroup> sections ordered by groupOrder (any group not
 *   listed is appended after). markAnomalous(value), if set, appends a
 *   ⚠ to that option's label without affecting its filter behavior. If
 *   allowedValues is set, it replaces the data-derived distinct list
 *   entirely — the dropdown offers only those values as selectable
 *   filter targets, but every row (including ones outside that list)
 *   stays fully visible in the table/drilldown/CSV when no filter (or a
 *   different filter) is applied.
 */
const BLANK_FILTER_VALUE = '__blank__'
export default function DataTable({
  columns,
  rows,
  filters = [],
  pageSize = 25,
  exportName,
  searchable = true,
  initialSort = null,
  onRowClick,
}) {
  const [search, setSearch] = useState('')
  const [filterValues, setFilterValues] = useState({})
  const [sort, setSort] = useState(initialSort) // {key, dir}
  const [page, setPage] = useState(0)

  const filterOptions = useMemo(
    () =>
      filters.map((f) => {
        const distinct = f.allowedValues
          ? [...f.allowedValues]
          : [...new Set(rows.map((r) => r[f.key]).filter((v) => String(v).trim() !== ''))].sort()
        const buildOption = (v) => ({ value: v, label: f.markAnomalous?.(v) ? `${v} ⚠` : v })

        if (f.group) {
          const groupMap = new Map()
          for (const v of distinct) {
            const g = f.group(v)
            if (!groupMap.has(g)) groupMap.set(g, [])
            groupMap.get(g).push(buildOption(v))
          }
          const order = f.groupOrder || [...groupMap.keys()]
          const groups = order.filter((g) => groupMap.has(g)).map((g) => ({ label: g, options: groupMap.get(g) }))
          for (const g of groupMap.keys()) {
            if (!order.includes(g)) groups.push({ label: g, options: groupMap.get(g) })
          }
          const blankOption = f.blankLabel ? { value: BLANK_FILTER_VALUE, label: f.blankLabel } : null
          return { ...f, groups, blankOption }
        }

        const options = distinct.map(buildOption)
        if (f.blankLabel) options.push({ value: BLANK_FILTER_VALUE, label: f.blankLabel })
        return { ...f, options }
      }),
    [filters, rows]
  )

  const processed = useMemo(() => {
    let out = rows
    for (const [key, val] of Object.entries(filterValues)) {
      if (!val) continue
      out =
        val === BLANK_FILTER_VALUE
          ? out.filter((r) => String(r[key] ?? '').trim() === '')
          : out.filter((r) => r[key] === val)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      out = out.filter((r) =>
        columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q))
      )
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)
      const val = (r) => (col?.sortValue ? col.sortValue(r) : r[sort.key])
      out = [...out].sort((a, b) => {
        const av = val(a)
        const bv = val(b)
        const aBlank = av === '' || av === null || av === undefined
        const bBlank = bv === '' || bv === null || bv === undefined
        if (aBlank && bBlank) return 0
        if (aBlank) return 1
        if (bBlank) return -1
        const cmp =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv), 'en-GB', { numeric: true })
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }
    return out
  }, [rows, filterValues, search, sort, columns])

  const pageCount = Math.max(1, Math.ceil(processed.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = processed.slice(safePage * pageSize, (safePage + 1) * pageSize)

  const toggleSort = (col) => {
    if (col.sortable === false) return
    setSort((s) =>
      s?.key === col.key
        ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key: col.key, dir: 'asc' }
    )
  }

  const controls = searchable || filterOptions.length > 0 || exportName

  return (
    <div>
      {controls && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {searchable && (
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(0)
                }}
                placeholder="Search…"
                className="w-full text-sm border border-line rounded-lg pl-8 pr-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-brand-green/40"
              />
            </div>
          )}
          {filterOptions.map((f) => (
            <select
              key={f.key}
              value={filterValues[f.key] || ''}
              onChange={(e) => {
                setFilterValues((fv) => ({ ...fv, [f.key]: e.target.value }))
                setPage(0)
              }}
              className="text-sm border border-line rounded-lg px-2.5 py-2 bg-card text-ink focus:outline-none focus:ring-2 focus:ring-brand-green/40 max-w-[180px]"
            >
              <option value="">{f.label}: All</option>
              {f.groups ? (
                <>
                  {f.groups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  {f.blankOption && <option value={f.blankOption.value}>{f.blankOption.label}</option>}
                </>
              ) : (
                f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))
              )}
            </select>
          ))}
          {exportName && (
            <button
              onClick={() => downloadCSV(processed, columns, exportName)}
              className="ml-auto inline-flex items-center gap-1.5 text-xs border border-line rounded-lg px-3 py-2 text-muted hover:text-ink hover:bg-page transition-colors"
            >
              <Download size={13} /> Export CSV
            </button>
          )}
        </div>
      )}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left bg-page">
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c)}
                  className={`px-3 py-2.5 font-medium text-xs text-muted whitespace-nowrap select-none ${
                    c.sortable === false ? '' : 'cursor-pointer hover:text-ink'
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sort?.key === c.key &&
                      (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr
                key={r.opportunity_id || r.__key || i}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`border-t border-line/70 ${
                  onRowClick ? 'cursor-pointer hover:bg-page/70' : 'hover:bg-page/40'
                }`}
              >
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-2.5 whitespace-nowrap">
                    {c.render ? c.render(r) : displayValue(r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
            {!pageRows.length && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-muted">
                  No records
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-muted">
          <span>
            {fmtInt(processed.length)} records · page {safePage + 1} of {pageCount}
          </span>
          <div className="flex gap-1">
            <button
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              className="p-1.5 border border-line rounded-lg disabled:opacity-40 hover:bg-page"
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
              className="p-1.5 border border-line rounded-lg disabled:opacity-40 hover:bg-page"
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
