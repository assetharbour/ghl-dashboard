import { parseDate, isBlank } from './format'

// Sales-team KPIs. This is a line-for-line port of ghl-reporting-sync/app/sales_metrics.py, which holds the
// agreed definitions and their tests; src/lib/sales.test.js repeats those cases. Change both together.
//
//   booked      appointments booked in the period (by BOOKING date), not deleted (cancelled / no-show included)
//   due         booked, minus cancelled, minus still to come (starts in the future and still new/confirmed)
//   showed      status "showed"                  noShow  status "noshow"
//   rebooked    a cancelled / no-show appointment whose contact has another (not deleted) appointment booked later
//   full FF     the contact's Fact Find Outcome starts with "Full Fact Find". The outcome is stored per CONTACT, so
//               it is credited ONCE, to the contact's latest due appointment
//   completed   the contact's mortgage completed (completion date set, or the case is at Completion / Post
//               Completion), credited once to the latest due appointment and only if the completion is on or after
//               the day that appointment was booked
//   conversion               full FF / due           (appointment booked -> full fact find completed)
//   conversionToCompletion   completed / due         (appointment booked -> mortgage completed)
//   showRate  showed / due      ffPerShow  full FF / showed      completionPerFullFf  completed / full FF
// The booker is the OFFICIAL booker (booked_by_official), never the raw calendar name.

export const SALES_TEAM = ['Harry Kalsi', 'Ava Morris-Boundy', 'Hugo Sharpe']
export const ADVISORS = ['Henny Lessey', 'Joe Nicholls', 'Xavier Collin', 'Cecilia Szabo', 'Carl Gladman', 'Anthony Fox']
export const COMPLETION_STAGES = ['Completion', 'Post Completion']
export const UNKNOWN = '(unknown)'

export function nameTokens(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/\P{ASCII}/gu, '')
    .replace(/[^a-zA-Z\s'-]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

// Same person by name: identical, or the same first and last word ("Ava Mae Morris-Boundy" = "Ava Morris-Boundy").
export function namesMatch(a, b) {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (!ta.length || !tb.length) return false
  if (ta.join(' ') === tb.join(' ')) return true
  return ta.length >= 2 && tb.length >= 2 && ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1]
}

export function isFullFactFind(outcome) {
  return String(outcome ?? '').trim().toLowerCase().startsWith('full fact find')
}

const isDeleted = (a) => String(a.deleted ?? '').trim() !== ''
const time = (s) => parseDate(s)?.getTime() ?? null

// Appointments are compared as (booked_at, id) pairs; ISO text sorts chronologically.
// A NUL separator sorts below every character, so a blank booked_at sorts first exactly like the Python tuple
// (booked_at, id); with '|' it sorted LAST (found by the differential test).
const order = (a) => `${a.booked_at ?? ''}\u0000${a.appointment_id}`

export function startsInFuture(a, now) {
  const start = time(a.start_time)
  return start !== null && start > now.getTime() && ['', 'new', 'confirmed'].includes(a.status ?? '')
}

export function isDue(a, now) {
  return !['cancelled', 'invalid'].includes(a.status) && !startsInFuture(a, now)
}

/**
 * Contact facts from the Leads rows (one contact can have several rows):
 * { [contact_id]: { fact_find_outcome, completed, completed_at } }.
 */
export function contactInfoFromLeads(leadRows) {
  const info = {}
  for (const r of leadRows) {
    const id = r.contact_id
    if (!id) continue
    const entry = (info[id] ??= { fact_find_outcome: '', completed: false, completed_at: '' })
    if (!isBlank(r.fact_find_outcome) && isBlank(entry.fact_find_outcome)) entry.fact_find_outcome = r.fact_find_outcome
    const completed = !isBlank(r.completion_date) || COMPLETION_STAGES.includes(r.pipeline_stage)
    if (completed) {
      entry.completed = true
      const done = parseDate(r.completion_date)
      const current = parseDate(entry.completed_at)
      // the latest completion date wins: any completion after the booking counts
      if (done && (!current || done > current)) entry.completed_at = r.completion_date
    }
  }
  return info
}

const ratio = (n, d) => (d ? n / d : null)

/**
 * Which appointments carry the contact's single outcome / completion: the contact's LATEST due appointment
 * (all history, not just the period). Returns { creditedFf, creditedCompleted } as Sets of appointment ids.
 */
export function creditedAppointments(appointments, contacts, now) {
  const live = appointments.filter((a) => !isDeleted(a))
  const latestDue = new Map()
  for (const a of live) {
    if (!a.contact_id || !isDue(a, now)) continue
    const best = latestDue.get(a.contact_id)
    if (!best || order(a) > order(best)) latestDue.set(a.contact_id, a)
  }
  const creditedFf = new Set()
  const creditedCompleted = new Set()
  for (const [cid, appt] of latestDue) {
    const info = contacts[cid]
    if (!info) continue
    if (isFullFactFind(info.fact_find_outcome)) creditedFf.add(appt.appointment_id)
    if (info.completed) {
      const done = parseDate(info.completed_at)
      const booked = parseDate(appt.booked_at)
      if (!done || !booked || done >= booked) creditedCompleted.add(appt.appointment_id)
    }
  }
  return { creditedFf, creditedCompleted }
}

/**
 * True when the appointment's date falls inside [start, end) (either bound may be null) and it is not deleted.
 * `dateField` picks which date the range applies to: 'booked_at' (the day it was booked, the default) or
 * 'start_time' (the day the appointment takes place).
 */
export function bookedInPeriod(a, start, end, dateField = 'booked_at') {
  const t = time(a[dateField])
  return !isDeleted(a) && t !== null && (!start || t >= start.getTime()) && (!end || t < end.getTime())
}

/**
 * One row per person. group: 'booker' (official booker) or 'advisor'.
 * contacts: output of contactInfoFromLeads. start/end are Dates (end exclusive) or null.
 */
export function buildSalesTable(appointments, contacts, now, { start = null, end = null, group = 'booker', salesTeam = [], dateField = 'booked_at' } = {}) {
  const live = appointments.filter((a) => !isDeleted(a))
  const inPeriod = live.filter((a) => bookedInPeriod(a, start, end, dateField))

  const { creditedFf, creditedCompleted } = creditedAppointments(live, contacts, now)

  // rebooked: the contact has a later (not deleted) booking. One pass finds each contact's latest booking
  // (ids are unique, so "later than this one" is simply "this one is not the latest").
  const latestOrder = new Map()
  for (const a of live) {
    if (!a.contact_id) continue
    const o = order(a)
    if (!latestOrder.has(a.contact_id) || o > latestOrder.get(a.contact_id)) latestOrder.set(a.contact_id, o)
  }
  const rebooked = (a) => ['cancelled', 'noshow'].includes(a.status) && Boolean(a.contact_id) && order(a) < latestOrder.get(a.contact_id)

  const personOf = (a) => (group === 'booker' ? a.booked_by_official || UNKNOWN : a.advisor || UNKNOWN)
  const groups = new Map()
  for (const a of inPeriod) {
    const key = personOf(a)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(a)
  }

  const table = []
  for (const [person, rows] of groups) {
    const dueRows = rows.filter((r) => isDue(r, now))
    const count = (pred) => rows.filter(pred).length
    const fullFactFinds = dueRows.filter((r) => creditedFf.has(r.appointment_id)).length
    const completed = dueRows.filter((r) => creditedCompleted.has(r.appointment_id)).length
    const showed = count((r) => r.status === 'showed')
    table.push({
      person,
      booked: rows.length,
      cancelled: count((r) => r.status === 'cancelled'),
      noShow: count((r) => r.status === 'noshow'),
      rebooked: count(rebooked),
      showed,
      upcoming: count((r) => startsInFuture(r, now)),
      due: dueRows.length,
      fullFactFinds,
      completed,
      isSalesTeam: salesTeam.some((n) => namesMatch(person, n)),
      conversion: ratio(fullFactFinds, dueRows.length),
      conversionToCompletion: ratio(completed, dueRows.length),
      completionPerFullFf: ratio(completed, fullFactFinds),
      showRate: ratio(showed, dueRows.length),
      ffPerShow: ratio(fullFactFinds, showed),
    })
  }
  return table.sort((a, b) => a.person.toLowerCase().localeCompare(b.person.toLowerCase()))
}

/** Add the numeric fields of several rows (for team totals); ratios are recomputed from the sums. */
export function sumRows(rows) {
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0)
  const t = {
    booked: sum('booked'), cancelled: sum('cancelled'), noShow: sum('noShow'), rebooked: sum('rebooked'),
    showed: sum('showed'), upcoming: sum('upcoming'), due: sum('due'),
    fullFactFinds: sum('fullFactFinds'), completed: sum('completed'),
  }
  return {
    ...t,
    conversion: ratio(t.fullFactFinds, t.due),
    conversionToCompletion: ratio(t.completed, t.due),
    completionPerFullFf: ratio(t.completed, t.fullFactFinds),
    showRate: ratio(t.showed, t.due),
    ffPerShow: ratio(t.fullFactFinds, t.showed),
  }
}

/**
 * Appointments per listed advisor: who the appointments were booked WITH. Whoever books in GHL chooses the advisor (the calendar is not an
 * automatic rotation), so this is a distribution, not a fairness check. `share` is the advisor's part of the listed advisors' total.
 */
export function advisorDistribution(appointments, advisorNames, { start = null, end = null, dateField = 'booked_at' } = {}) {
  const counts = new Map(advisorNames.map((n) => [n, 0]))
  let other = 0
  for (const a of appointments) {
    if (!bookedInPeriod(a, start, end, dateField)) continue
    const match = advisorNames.find((n) => namesMatch(a.advisor, n))
    if (match) counts.set(match, counts.get(match) + 1)
    else other += 1
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  const rows = [...counts].map(([person, appointmentsCount]) => ({
    person,
    appointments: appointmentsCount,
    share: total ? appointmentsCount / total : null,
  }))
  if (other) rows.push({ person: '(not a listed advisor)', appointments: other, share: null })
  return rows
}

// ---------------------------------------------------------------- weeks and the forward view

export function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Monday 00:00 (local) of the week containing d. */
export function weekStart(d) {
  const x = startOfDay(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shortDay = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

/** Bookings per Monday-start week for each person, oldest week first. Empty weeks inside the range are kept. */
export function weeklyBookings(appointments, personOf, { start = null, end = null, dateField = 'booked_at' } = {}) {
  const rows = appointments.filter((a) => bookedInPeriod(a, start, end, dateField))
  if (!rows.length) return { weeks: [], people: [] }
  const people = [...new Set(rows.map(personOf))].sort()
  const times = rows.map((a) => time(a[dateField]))
  const first = weekStart(new Date(start ?? Math.min(...times)))
  const last = weekStart(new Date(end ? end.getTime() - 1 : Math.max(...times)))
  const byWeek = new Map()
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 7)) {
    byWeek.set(isoDay(d), { week: `w/c ${shortDay(d)}`, key: isoDay(d), ...Object.fromEntries(people.map((p) => [p, 0])) })
  }
  for (const a of rows) {
    const bucket = byWeek.get(isoDay(weekStart(new Date(time(a[dateField])))))
    if (bucket) bucket[personOf(a)] += 1
  }
  return { weeks: [...byWeek.values()], people }
}

/** The coming Monday-Friday: appointments (not cancelled / deleted) per day and per advisor. */
export function forwardWeek(appointments, now) {
  const monday = startOfDay(now)
  monday.setDate(monday.getDate() + (((8 - monday.getDay()) % 7) || 7))    // the next Monday after today
  const days = []
  for (let i = 0; i < 5; i++) {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    days.push({ date: day, key: isoDay(day), label: day.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }), appointments: [] })
  }
  const byKey = new Map(days.map((d) => [d.key, d]))
  for (const a of appointments) {
    if (isDeleted(a) || ['cancelled', 'invalid'].includes(a.status)) continue
    const start = parseDate(a.start_time)
    const day = start && byKey.get(isoDay(start))
    if (day) day.appointments.push(a)
  }
  return { monday, days }
}

// ---------------------------------------------------------------- Created By

/**
 * Leads added per LOCKED Created By value. `locks`: rows of the Field_Locks tab where field == created_by.
 * leadRows: Leads rows already filtered to the period. Counts distinct contacts.
 */
export function createdByReport(leadRows, locks, appointments, contacts) {
  const owner = new Map(locks.filter((l) => l.field === 'created_by').map((l) => [l.contact_id, l.first_value]))
  const withAppointment = new Set(appointments.filter((a) => !isDeleted(a)).map((a) => a.contact_id))
  const people = new Map()
  const seen = new Set()
  for (const r of leadRows) {
    if (!r.contact_id || seen.has(r.contact_id)) continue
    seen.add(r.contact_id)
    const person = owner.get(r.contact_id) || '(not recorded)'
    const e = people.get(person) ?? { person, leads: 0, appointments: 0, fullFactFinds: 0 }
    e.leads += 1
    if (withAppointment.has(r.contact_id)) e.appointments += 1
    if (isFullFactFind(contacts[r.contact_id]?.fact_find_outcome)) e.fullFactFinds += 1
    people.set(person, e)
  }
  return [...people.values()].sort((a, b) => b.leads - a.leads)
}

// ---------------------------------------------------------------- full fact finds by month (the pay report)

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/** The last n calendar months as [{ key: '2026-10', label: 'Oct 2026' }], oldest first. */
export function lastMonths(now, n = 6) {
  const months = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ key: monthKey(d), label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) })
  }
  return months
}

/**
 * Completed full fact finds per person per month of the APPOINTMENT date: the contact's outcome is credited to
 * its latest due appointment (see creditedAppointments), then counted by the month that appointment took place.
 * Rows: { person, counts: { '2026-10': n }, total } (total = the listed months only), most first.
 */
export function fullFactFindsByMonth(appointments, contacts, now, personOf, months) {
  const { creditedFf } = creditedAppointments(appointments, contacts, now)
  const wanted = new Set(months.map((m) => m.key))
  const people = new Map()
  for (const a of appointments) {
    if (isDeleted(a) || !creditedFf.has(a.appointment_id)) continue
    const start = parseDate(a.start_time)
    if (!start || !wanted.has(monthKey(start))) continue
    const person = personOf(a)
    const entry = people.get(person) ?? { person, counts: Object.fromEntries(months.map((m) => [m.key, 0])), total: 0 }
    entry.counts[monthKey(start)] += 1
    entry.total += 1
    people.set(person, entry)
  }
  return [...people.values()].sort((a, b) => b.total - a.total || a.person.localeCompare(b.person))
}
