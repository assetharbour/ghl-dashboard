import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Overview from './pages/Overview'
import Leads from './pages/Leads'
import Introducers from './pages/Introducers'
import Advisors from './pages/Advisors'
import Calls from './pages/Calls'
import Cases from './pages/Cases'
import Gapping from './pages/Gapping'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/introducers" element={<Introducers />} />
        <Route path="/advisors" element={<Advisors />} />
        <Route path="/calls" element={<Calls />} />
        <Route path="/cases" element={<Cases />} />
        <Route path="/gapping" element={<Gapping />} />
      </Route>
    </Routes>
  )
}
