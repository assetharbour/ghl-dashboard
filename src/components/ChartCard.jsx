import Skeleton from './Skeleton'
import { useData } from '../context/DataContext'

export default function ChartCard({ title, subtitle, children, className = '' }) {
  const { loading } = useData()
  if (loading) return <Skeleton className={`h-80 ${className}`} />
  return (
    <div className={`card p-5 ${className}`}>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}
