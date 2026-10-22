// Run: npx vite-node qa/perf.mjs
// Times the dashboard KPI code on 1,000 / 5,000 / 20,000 appointments (the real volume is ~200 per 75 days).
import { buildSalesTable, roundRobinFairness, weeklyBookings, forwardWeek, fullFactFindsByMonth, lastMonths, contactInfoFromLeads, createdByReport } from '../src/lib/sales.js'

const NOW = new Date('2026-10-22T12:00:00Z')
const STATUS = ['confirmed', 'showed', 'showed', 'noshow', 'cancelled', 'new']
const PEOPLE = ['Hugo Sharpe', 'Ava Morris-Boundy', 'Harry Kalsi', 'Sarah Bennett']
const ADV = ['Joe Nicholls', 'Xavier Collin', 'Cecilia Szabo', 'Henny Lessey']
let seed = 1
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const pick = (a) => a[Math.floor(rnd() * a.length)]

function data(n) {
  const contacts = {}
  const leads = []
  for (let i = 0; i < n / 2; i++) {
    contacts[`c${i}`] = { fact_find_outcome: rnd() < 0.4 ? 'Full Fact Find Took Place - YES' : '', completed: rnd() < 0.1, completed_at: '2026-09-01' }
    leads.push({ contact_id: `c${i}`, pipeline_stage: 'Docs Requested', completion_date: '' })
  }
  const appts = []
  for (let i = 0; i < n; i++) {
    const booked = new Date(NOW.getTime() - rnd() * 365 * 86400000)
    appts.push({
      appointment_id: `a${i}`, contact_id: `c${Math.floor(rnd() * (n / 2))}`, booked_by_official: pick(PEOPLE), advisor: pick(ADV),
      booked_at: booked.toISOString(), start_time: new Date(booked.getTime() + rnd() * 10 * 86400000).toISOString(), status: pick(STATUS), deleted: '',
    })
  }
  return { appts, contacts, leads }
}

for (const n of [1000, 5000, 20000]) {
  const { appts, contacts, leads } = data(n)
  const t = performance.now()
  buildSalesTable(appts, contacts, NOW, { group: 'booker' })
  buildSalesTable(appts, contacts, NOW, { group: 'advisor' })
  roundRobinFairness(appts, ADV)
  weeklyBookings(appts, (a) => a.booked_by_official)
  forwardWeek(appts, NOW)
  fullFactFindsByMonth(appts, contacts, NOW, (a) => a.advisor, lastMonths(NOW, 6))
  contactInfoFromLeads(leads)
  createdByReport(leads, [], appts, contacts)
  console.log(`${String(n).padStart(6)} appointments: ${(performance.now() - t).toFixed(0)} ms for one full page computation`)
}
