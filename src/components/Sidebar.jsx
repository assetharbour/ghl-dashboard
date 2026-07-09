import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Inbox,
  Users,
  TrendingUp,
  Phone,
  FolderOpen,
  ShieldAlert,
  X,
} from 'lucide-react'
import logo from '../assets/assetharbour-logo.png'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/leads', label: 'Leads Received', icon: Inbox },
  { to: '/introducers', label: 'Introducer Reports', icon: Users },
  { to: '/advisors', label: 'Advisor Performance', icon: TrendingUp },
  { to: '/calls', label: 'Call Tracking', icon: Phone },
  { to: '/cases', label: 'Case Management', icon: FolderOpen },
  { to: '/gapping', label: 'Gapping', icon: ShieldAlert },
]

export default function Sidebar({ open, onClose }) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-brand-navy flex flex-col transition-transform duration-200 lg:translate-x-0 lg:static ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="bg-white px-5 py-4 flex items-center justify-between border-b border-line">
          <img src={logo} alt="Asset Harbour" className="h-10 w-auto" />
          <button
            className="lg:hidden text-ink p-1"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-2.5 text-sm border-l-[3px] transition-colors ${
                  isActive
                    ? 'border-brand-green bg-white/10 text-white font-medium'
                    : 'border-transparent text-white/70 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <Icon size={17} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 text-[11px] text-white/40 border-t border-white/10">
          Asset Harbour Mortgage
          <br />
          Reporting Dashboard
        </div>
      </aside>
    </>
  )
}
