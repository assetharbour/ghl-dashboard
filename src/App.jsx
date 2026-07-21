import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Overview from './pages/Overview'
import Leads from './pages/Leads'
import Introducers from './pages/Introducers'
import Advisors from './pages/Advisors'
import Calls from './pages/Calls'
import Cases from './pages/Cases'
import Gapping from './pages/Gapping'
import UnderDevelopment from './pages/UnderDevelopment'

// Temporary — client requested these pages gated behind a placeholder
// while data quality is finalized. Remove entries from this array (or
// empty it entirely) to restore full access.
// Added 2026-07-10. Advisor Performance went live 2026-07-17.
// Call Tracking, Case Management, and Gapping went live 2026-07-17.
const PAGES_UNDER_DEVELOPMENT = []

const ROUTES = [
  { key: 'overview', path: '/', label: 'Overview', Component: Overview },
  { key: 'leads', path: '/leads', label: 'Leads Received', Component: Leads },
  { key: 'introducers', path: '/introducers', label: 'Introducer Reports', Component: Introducers },
  { key: 'advisors', path: '/advisors', label: 'Advisor Performance', Component: Advisors },
  { key: 'calls', path: '/calls', label: 'Call Tracking', Component: Calls },
  { key: 'cases', path: '/cases', label: 'Case Management', Component: Cases },
  { key: 'gapping', path: '/gapping', label: 'Gapping', Component: Gapping },
]

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {ROUTES.map(({ key, path, label, Component }) => (
          <Route
            key={key}
            path={path}
            element={
              PAGES_UNDER_DEVELOPMENT.includes(key) ? (
                <UnderDevelopment pageName={label} />
              ) : (
                <Component />
              )
            }
          />
        ))}
      </Route>
    </Routes>
  )
}
