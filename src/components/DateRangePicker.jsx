import { useEffect, useRef, useState } from 'react'
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { DATE_RANGES } from '../lib/metrics'

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function sameDay(a, b) {
  return a && b && a.toDateString() === b.toDateString()
}

function fmtShort(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Sun-start month grid, padded with nulls before day 1 so the day-of-week
// columns line up under the weekday header.
function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = Array(first.getDay()).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  return cells
}

/**
 * Date range control: preset shortcuts (from DATE_RANGES) plus a calendar
 * for picking an exact from/to range. Click a start day, then an end day —
 * clicking before the current start restarts the selection from there.
 */
export default function DateRangePicker({ value, customRange, onPreset, onCustomRange }) {
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => customRange?.from || new Date())
  const [pendingFrom, setPendingFrom] = useState(customRange?.from || null)
  const [pendingTo, setPendingTo] = useState(customRange?.to || null)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const label =
    value === 'custom' && customRange?.from && customRange?.to
      ? `${fmtShort(customRange.from)} – ${fmtShort(customRange.to)}`
      : DATE_RANGES.find((r) => r.id === value)?.label || 'All time'

  const handleDayClick = (day) => {
    if (!pendingFrom || pendingTo) {
      setPendingFrom(day)
      setPendingTo(null)
    } else if (day < pendingFrom) {
      setPendingFrom(day)
      setPendingTo(null)
    } else {
      setPendingTo(day)
    }
  }

  const apply = () => {
    if (!pendingFrom || !pendingTo) return
    onCustomRange({ from: startOfDay(pendingFrom), to: startOfDay(pendingTo) })
    setOpen(false)
  }

  const changeMonth = (delta) =>
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1))

  const cells = buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth())
  const monthLabel = viewDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const inRange = (d) => pendingFrom && pendingTo && d >= pendingFrom && d <= pendingTo
  const isEdge = (d) => sameDay(d, pendingFrom) || sameDay(d, pendingTo)

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm border border-line rounded-lg px-2.5 py-1.5 bg-card text-ink hover:bg-page transition-colors whitespace-nowrap"
        aria-label="Date range"
      >
        <Calendar size={14} className="text-muted shrink-0" />
        {label}
        <ChevronDown size={13} className="text-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 z-30 bg-card border border-line rounded-xl shadow-lg p-3 flex gap-3 w-[340px]">
          <div className="flex flex-col gap-0.5 pr-3 border-r border-line shrink-0 w-[112px]">
            {DATE_RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onPreset(r.id)
                  setOpen(false)
                }}
                className={`text-left text-xs px-2 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                  value === r.id
                    ? 'bg-brand-green/10 text-brand-green font-medium'
                    : 'text-muted hover:bg-page hover:text-ink'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => changeMonth(-1)}
                className="p-1 rounded hover:bg-page text-muted"
                aria-label="Previous month"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs font-medium text-ink">{monthLabel}</span>
              <button
                onClick={() => changeMonth(1)}
                className="p-1 rounded hover:bg-page text-muted"
                aria-label="Next month"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {WEEKDAY_LABELS.map((d, i) => (
                <div key={i} className="text-[10px] text-muted py-1">
                  {d}
                </div>
              ))}
              {cells.map((d, i) => (
                <button
                  key={i}
                  disabled={!d}
                  onClick={() => d && handleDayClick(d)}
                  className={`text-xs py-1.5 rounded-md ${
                    !d
                      ? ''
                      : isEdge(d)
                        ? 'bg-brand-green text-white font-medium'
                        : inRange(d)
                          ? 'bg-brand-green/10 text-brand-green'
                          : 'text-ink hover:bg-page'
                  }`}
                >
                  {d ? d.getDate() : ''}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-line gap-2">
              <span className="text-[11px] text-muted truncate">
                {pendingFrom ? fmtShort(pendingFrom) : 'Start'} – {pendingTo ? fmtShort(pendingTo) : 'End'}
              </span>
              <button
                onClick={apply}
                disabled={!pendingFrom || !pendingTo}
                className="text-xs bg-brand-green text-white rounded-lg px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
