// Client call lists for the admin team: annual review calls by month, and the ERC (product end) list for the
// advisers. Both read every case (allRows), not just leads created in the date range picked at the top: a mortgage
// written in 2024 still needs its review call this month.
import { parseDate, isBlank } from './format'
import { productEndDate, isCompleted } from './metrics'

const DAY = 86400000
const FIRST_REVIEW_AFTER_DAYS = 300

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function contactKey(r) {
  const id = String(r.contact_id ?? '').trim()
  return id || `opp:${r.opportunity_id ?? r.client_name ?? ''}`
}

// Same colour rule as the Product Roll-off table: pink within 30 days, amber within 90, green beyond.
export function ercBand(date, now = new Date()) {
  const d = parseDate(date)
  if (!d) return null
  // whole days, so a date-only value parsed as UTC midnight is not pushed over a boundary by the viewer's time zone
  const days = Math.round((d.getTime() - startOfDay(now).getTime()) / DAY)
  if (days <= 30) return 'pink'
  if (days <= 90) return 'amber'
  return 'green'
}

export const BAND_LABEL = { pink: 'Within 30 days', amber: '31 to 90 days', green: 'Over 90 days' }

// Months the annual review list can show: this month and the next `count` - 1.
export function reviewMonths(now = new Date(), count = 24) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      year: d.getFullYear(),
      month: d.getMonth(),
      label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    }
  })
}

// Annual review calls falling in one calendar month. A client is called once a year on the anniversary of their
// product end date (the ERC Date), up to and including the end date itself, the same rule as Call Tracking. A
// client with more than one case due that month is listed once, on the earliest call, with the other cases noted.
// Calls already past in the current month stay on the list for that month so the team can see what was missed.
export function annualReviewsForMonth(allRows, year, month) {
  const byContact = new Map()
  for (const r of allRows) {
    const end = parseDate(productEndDate(r))
    if (!end || year > end.getFullYear()) continue
    if (end.getMonth() !== month) continue
    // 29 Feb product end dates fall on 28 Feb in other years
    const day = Math.min(end.getDate(), new Date(year, month + 1, 0).getDate())
    const due = new Date(year, month, day)
    if (due.getTime() > startOfDay(end).getTime()) continue
    const callsLeft = end.getFullYear() - year + 1
    // The first review comes about a year into the mortgage: no review call within 10 months of the completion date
    // (actual, or expected on a case still going through), except the final call on the product end date itself.
    const completion = parseDate(r.completion_date)
    if (completion && callsLeft > 1 && due.getTime() < completion.getTime() + FIRST_REVIEW_AFTER_DAYS * DAY) continue
    const row = {
      ...r,
      __productEnd: productEndDate(r),
      __due: due,
      __callsLeft: callsLeft,
      __finalCall: callsLeft === 1,
      __completedWithUs: isCompleted(r),
      __otherCases: 0,
    }
    const key = contactKey(r)
    const prev = byContact.get(key)
    if (!prev) byContact.set(key, row)
    else if (row.__due < prev.__due) byContact.set(key, { ...row, __otherCases: prev.__otherCases + 1 })
    else prev.__otherCases += 1
  }
  return [...byContact.values()].sort((a, b) => a.__due - b.__due || String(a.client_name).localeCompare(String(b.client_name)))
}

// Every case whose product ends from today to the end of `untilYear` (31 Dec), soonest first, with its colour band.
export function ercList(allRows, now = new Date(), untilYear = 2027) {
  const from = startOfDay(now).getTime()
  const to = new Date(untilYear + 1, 0, 1).getTime()
  return allRows
    .map((r) => {
      const end = parseDate(productEndDate(r))
      if (!end) return null
      const t = end.getTime()
      if (t < from || t >= to) return null
      return {
        ...r,
        __productEnd: productEndDate(r),
        __endTime: t,
        __daysLeft: Math.round((t - from) / DAY),
        __band: ercBand(end, now),
        __completedWithUs: isCompleted(r),
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.__endTime - b.__endTime || String(a.client_name).localeCompare(String(b.client_name)))
}

export function bandCounts(list) {
  const out = { pink: 0, amber: 0, green: 0 }
  for (const r of list) if (r.__band) out[r.__band] += 1
  return out
}

export function nameOrBlank(v) {
  return isBlank(v) ? '' : String(v).trim()
}
