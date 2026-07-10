import { Construction } from 'lucide-react'

/**
 * Reusable placeholder shown in place of a real page while it's
 * temporarily gated — see PAGES_UNDER_DEVELOPMENT in App.jsx.
 */
export default function UnderDevelopment({ pageName }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="card p-10 max-w-md text-center">
        <div className="w-12 h-12 rounded-full bg-brand-green/10 flex items-center justify-center mx-auto mb-4">
          <Construction size={22} className="text-brand-green" strokeWidth={1.8} />
        </div>
        <h2 className="text-lg font-semibold text-ink mb-2">{pageName}</h2>
        <p className="text-sm text-muted leading-relaxed">
          This section is being refined and will be available soon.
        </p>
      </div>
    </div>
  )
}
