import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import DrilldownPanel from './DrilldownPanel'
import { useData } from '../context/DataContext'
import { AlertTriangle } from 'lucide-react'

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { error, loading } = useData()

  return (
    <div className="flex min-h-screen">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onMenu={() => setMenuOpen(true)} />
        <main className="flex-1 p-4 lg:p-6 space-y-5">
          {error && !loading && (
            <div className="card px-4 py-3 flex items-center gap-2 text-sm text-brand-pink border-brand-pink/30">
              <AlertTriangle size={16} />
              Failed to load data: {error}
            </div>
          )}
          <Outlet />
        </main>
      </div>
      <DrilldownPanel />
    </div>
  )
}
