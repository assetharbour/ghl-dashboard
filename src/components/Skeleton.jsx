export default function Skeleton({ className = '' }) {
  return (
    <div className={`card overflow-hidden ${className}`}>
      <div className="h-full w-full animate-pulse bg-gradient-to-r from-transparent via-page to-transparent bg-page" />
    </div>
  )
}

export function SkeletonBlock({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-line/60 ${className}`} />
}
