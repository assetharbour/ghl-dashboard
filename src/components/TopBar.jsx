import { useLocation } from 'react-router-dom'
import { Menu, RefreshCw } from 'lucide-react'
import { useData } from '../context/DataContext'
import { DATE_RANGES } from '../lib/metrics'
import { relTime } from '../lib/format'

const TITLES = {
  '/': 'Overview',
  '/leads': 'Leads Received',
  '/introducers': 'Introducer Reports',
  '/advisors': 'Advisor Performance',
  '/calls': 'Call Tracking',
  '/cases': 'Case Management',
  '/gapping': 'Gapping',
}

export default function TopBar({ onMenu }) {
  const { pathname } = useLocation()
  const { lastSync, refresh, refreshing, dateRange, setDateRange } = useData()

  return (
    <header className="bg-card border-b border-line px-4 lg:px-6 py-3 flex items-center gap-3 sticky top-0 z-20">
      <button className="lg:hidden p-1.5 -ml-1 text-ink" onClick={onMenu} aria-label="Open menu">
        <Menu size={20} />
      </button>
      <h1 className="page-title truncate">{TITLES[pathname] || 'Dashboard'}</h1>
      <div className="ml-auto flex items-center gap-2 lg:gap-3">
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="text-sm border border-line rounded-lg px-2.5 py-1.5 bg-card text-ink focus:outline-none focus:ring-2 focus:ring-brand-green/40"
          aria-label="Date range"
        >
          {DATE_RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted bg-page border border-line rounded-full px-3 py-1.5 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-green inline-block" />
          Updated {relTime(lastSync)}
        </span>
        <button
          onClick={refresh}
          className="p-2 rounded-lg border border-line text-muted hover:text-ink hover:bg-page transition-colors"
          aria-label="Refresh data"
          title="Refresh"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
    </header>
  )
}
