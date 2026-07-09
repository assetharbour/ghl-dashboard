import { ChevronRight } from 'lucide-react'
import Skeleton from './Skeleton'
import { useData } from '../context/DataContext'

/**
 * The one KPI card used everywhere.
 * onClick opens a drill-down; alert renders the value in the accent pink.
 */
export default function KPICard({ label, value, sub, onClick, alert = false }) {
  const { loading } = useData()
  const clickable = typeof onClick === 'function'

  if (loading) return <Skeleton className="h-[104px]" />

  const Tag = clickable ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`card px-4 py-4 text-left w-full group ${
        clickable ? 'hover:border-brand-green/50 transition-colors cursor-pointer' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="kpi-label">{label}</span>
        {clickable && (
          <ChevronRight
            size={14}
            className="text-muted/50 group-hover:text-brand-green transition-colors"
          />
        )}
      </div>
      <div className={`kpi-value mt-1.5 ${alert ? 'text-brand-pink' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </Tag>
  )
}
