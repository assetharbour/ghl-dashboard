// The sales KPIs decide what the sales team is paid, so these mirror the Python reference tests
// (ghl-reporting-sync/tests/test_audit.py) case for case.
process.env.TZ = 'Europe/London'

import { describe, it, expect } from 'vitest'
import {
  buildSalesTable, sumRows, advisorDistribution, contactInfoFromLeads, createdByReport,
  isFullFactFind, namesMatch, weekStart, weeklyBookings, forwardWeek, SALES_TEAM, fullFactFindsByMonth, lastMonths, creditedAppointments,
} from './sales'
import { rangeBounds, filterByDateRange } from './metrics'
import { flagValues } from './flags'

const NOW = new Date('2026-10-22T12:00:00Z')

function appt(id, contact, o = {}) {
  return {
    appointment_id: id, contact_id: contact, booked_by_official: 'Hugo Sharpe', advisor: 'Joe Nicholls',
    booked_at: '2026-10-05T09:00:00Z', start_time: '2026-10-08T09:00:00Z', status: 'showed', deleted: '', ...o,
  }
}
const FULL = { fact_find_outcome: 'Full Fact Find Took Place - YES' }
const ADVICE = { fact_find_outcome: 'Advice Given - YES' }
const byPerson = (table) => Object.fromEntries(table.map((r) => [r.person, r]))

describe('conversion', () => {
  it('is full fact finds over due appointments per booker', () => {
    const appts = [
      appt('1', 'c1'), appt('2', 'c2'), appt('3', 'c3', { status: 'noshow' }), appt('4', 'c4', { status: 'cancelled' }),
      appt('5', 'c5', { start_time: '2026-10-30T09:00:00Z', status: 'confirmed' }),
      appt('6', 'c6', { booked_by_official: 'Harry Kalsi' }), appt('7', 'c7', { deleted: 'TRUE' }),
    ]
    const contacts = { c1: FULL, c2: ADVICE, c6: FULL, c4: FULL, c7: FULL }
    const t = byPerson(buildSalesTable(appts, contacts, NOW))
    const h = t['Hugo Sharpe']
    expect([h.booked, h.cancelled, h.noShow, h.showed, h.upcoming, h.due]).toEqual([5, 1, 1, 2, 1, 3])
    expect(h.fullFactFinds).toBe(1)
    expect(h.conversion).toBeCloseTo(1 / 3, 10)
    expect(h.showRate).toBeCloseTo(2 / 3, 10)
    expect(h.ffPerShow).toBe(0.5)
    expect(t['Harry Kalsi'].conversion).toBe(1)
    expect(Object.values(t).reduce((n, r) => n + r.booked, 0)).toBe(6) // the deleted one never counts
  })

  it("credits a contact's single outcome once, to its latest due appointment", () => {
    const appts = [
      appt('1', 'c1', { booked_by_official: 'Harry Kalsi', booked_at: '2026-10-01T09:00:00Z', status: 'noshow' }),
      appt('2', 'c1', { booked_by_official: 'Hugo Sharpe', booked_at: '2026-10-06T09:00:00Z' }),
    ]
    const t = byPerson(buildSalesTable(appts, { c1: FULL }, NOW))
    expect(t['Hugo Sharpe'].fullFactFinds).toBe(1)
    expect(t['Harry Kalsi'].fullFactFinds).toBe(0)
  })

  it('filters by the booking date and gives null for empty denominators', () => {
    const appts = [appt('1', 'c1', { booked_at: '2026-09-20T09:00:00Z' }), appt('2', 'c2', { status: 'cancelled' })]
    const [row] = buildSalesTable(appts, { c1: FULL }, NOW, { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') })
    expect([row.booked, row.due, row.conversion, row.showRate, row.ffPerShow]).toEqual([1, 0, null, null, null])
  })

  it('also groups by advisor, and unknown people', () => {
    const appts = [appt('1', 'c1'), appt('2', 'c2', { advisor: 'Xavier Collin' }), appt('3', 'c3', { advisor: '' })]
    const t = buildSalesTable(appts, {}, NOW, { group: 'advisor' })
    expect(t.map((r) => r.person).sort()).toEqual(['(unknown)', 'Joe Nicholls', 'Xavier Collin'])
  })

  it('uses the official booker, not the calendar name', () => {
    const a = { ...appt('1', 'c1', { booked_by_official: 'Ava Morris-Boundy' }), booked_by: 'Someone From The Calendar' }
    expect(buildSalesTable([a], {}, NOW)[0].person).toBe('Ava Morris-Boundy')
    expect(buildSalesTable([{ ...a, booked_by_official: '' }], {}, NOW)[0].person).toBe('(unknown)')
  })

  it('marks the sales team (Harry, Ava, Hugo) and nobody else', () => {
    const appts = [appt('1', 'c1'), appt('2', 'c2', { booked_by_official: 'Sarah Bennett' })]
    const t = byPerson(buildSalesTable(appts, {}, NOW, { salesTeam: SALES_TEAM }))
    expect([t['Hugo Sharpe'].isSalesTeam, t['Sarah Bennett'].isSalesTeam]).toEqual([true, false])
  })
})

describe('completion', () => {
  it('credits each contact once and only after the appointment was booked', () => {
    const appts = [appt('1', 'c1'), appt('2', 'c2'), appt('3', 'c3'), appt('4', 'c4', { booked_by_official: 'Harry Kalsi' })]
    const contacts = {
      c1: { ...FULL, completed: true, completed_at: '2026-10-15' },
      c2: { completed: true, completed_at: '2026-09-01' }, // before the appointment was booked: older business
      c3: { completed: true, completed_at: '' }, // completed, date unknown: counts
      c4: { ...FULL, completed: false },
    }
    const t = byPerson(buildSalesTable(appts, contacts, NOW, { salesTeam: SALES_TEAM }))
    const h = t['Hugo Sharpe']
    const k = t['Harry Kalsi']
    expect([h.due, h.fullFactFinds, h.completed]).toEqual([3, 1, 2])
    expect(h.conversionToCompletion).toBeCloseTo(2 / 3, 10)
    expect(h.completionPerFullFf).toBe(2)
    expect([k.completed, k.conversionToCompletion, k.completionPerFullFf]).toEqual([0, 0, 0])
  })

  it('credits a completed contact to one appointment only', () => {
    const appts = [
      appt('1', 'c1', { booked_by_official: 'Harry Kalsi', booked_at: '2026-10-01T09:00:00Z', status: 'noshow' }),
      appt('2', 'c1', { booked_by_official: 'Hugo Sharpe', booked_at: '2026-10-06T09:00:00Z' }),
    ]
    const t = byPerson(buildSalesTable(appts, { c1: { completed: true, completed_at: '2026-10-20' } }, NOW))
    expect([t['Hugo Sharpe'].completed, t['Harry Kalsi'].completed]).toEqual([1, 0])
  })
})

describe('ordering', () => {
  it('never treats an appointment with a blank booking time as the latest (QA-F2, found by differential testing)', () => {
    const appts = [appt('1', 'c1', { booked_by_official: 'Harry Kalsi', booked_at: '' }), appt('2', 'c1', { booked_by_official: 'Hugo Sharpe', booked_at: '2026-10-06T09:00:00Z' })]
    const t = byPerson(buildSalesTable(appts, { c1: FULL }, NOW))
    expect(t['Hugo Sharpe'].fullFactFinds).toBe(1)
    expect(t['Harry Kalsi']).toBeUndefined()
  })
})

describe('upcoming', () => {
  it('only counts appointments that are still on (not cancelled) and start in the future', () => {
    const appts = [
      appt('1', 'c1', { start_time: '2026-10-30T09:00:00Z', status: 'confirmed' }),
      appt('2', 'c2', { start_time: '2026-10-30T09:00:00Z', status: 'cancelled' }),
      appt('3', 'c3', { start_time: '2026-10-30T09:00:00Z', status: 'noshow' }),
    ]
    const [row] = buildSalesTable(appts, {}, NOW)
    expect([row.upcoming, row.cancelled, row.noShow, row.due]).toEqual([1, 1, 1, 1])
  })
})

describe('rebooked', () => {
  it('is a cancelled or no-show appointment whose contact has a later booking', () => {
    const appts = [
      appt('1', 'c1', { status: 'noshow', booked_at: '2026-10-01T09:00:00Z' }), appt('2', 'c1', { booked_at: '2026-10-06T09:00:00Z' }),
      appt('3', 'c2', { status: 'cancelled', booked_at: '2026-10-02T09:00:00Z' }),
      appt('4', 'c3', { status: 'cancelled', booked_at: '2026-10-03T09:00:00Z' }), appt('5', 'c3', { booked_at: '2026-10-07T09:00:00Z', deleted: 'TRUE' }),
      appt('6', 'c4', { booked_at: '2026-10-03T09:00:00Z' }), appt('7', 'c4', { booked_at: '2026-10-08T09:00:00Z', status: 'noshow' }),
    ]
    const [row] = buildSalesTable(appts, {}, NOW)
    expect([row.noShow, row.cancelled, row.rebooked]).toEqual([2, 2, 1])
  })
})

describe('helpers', () => {
  it('counts only full fact find outcomes', () => {
    expect(['Full Fact Find Took Place - YES', 'Full Fact Find took place: Yes'].map(isFullFactFind)).toEqual([true, true])
    expect(['Advice Given - YES', 'Review - YES', 'Annual Review - YES', 'Amendment - YES', '', null].map(isFullFactFind)).toEqual(Array(6).fill(false))
  })

  it('matches names by first and last word', () => {
    expect(namesMatch('Ava Mae Morris-Boundy', 'Ava Morris-Boundy')).toBe(true)
    expect(namesMatch('Zoë Müller', 'Zoe Muller')).toBe(true)
    expect(namesMatch('Joe', 'Joe Nicholls')).toBe(false)
    expect(namesMatch('Joe Nicholls', 'Joe Smith')).toBe(false) // same first name, different person
    expect(namesMatch('', 'Joe Nicholls')).toBe(false)
  })

  it('sums rows and recomputes the ratios from the sums', () => {
    const a = { booked: 4, cancelled: 0, noShow: 0, rebooked: 0, showed: 2, upcoming: 0, due: 4, fullFactFinds: 1, completed: 0 }
    const b = { ...a, due: 2, fullFactFinds: 1, completed: 1 }
    const s = sumRows([a, b])
    expect([s.due, s.fullFactFinds]).toEqual([6, 2])
    expect(s.conversion).toBeCloseTo(1 / 3, 10)
    expect(s.conversionToCompletion).toBeCloseTo(1 / 6, 10)
  })

  it('builds contact facts from Leads rows (latest completion wins, stage counts as completed)', () => {
    const info = contactInfoFromLeads([
      { contact_id: 'c1', fact_find_outcome: 'Review - YES', completion_date: '2026-01-01', pipeline_stage: 'Lead Received' },
      { contact_id: 'c1', fact_find_outcome: '', completion_date: '2026-06-01', pipeline_stage: 'Completion' },
      { contact_id: 'c2', pipeline_stage: 'Post Completion', completion_date: '' },
      { contact_id: 'c3', pipeline_stage: 'Docs Requested', completion_date: '' },
      { contact_id: '', pipeline_stage: 'Completion' },
    ])
    expect(info.c1).toEqual({ fact_find_outcome: 'Review - YES', completed: true, completed_at: '2026-06-01' })
    expect(info.c2.completed).toBe(true)
    expect(info.c3.completed).toBe(false)
    expect(Object.keys(info)).toEqual(['c1', 'c2', 'c3'])
  })

  it('counts appointments per advisor and reports non-advisors', () => {
    const appts = [...Array(6).keys()].map((i) => appt(`a${i}`, `c${i}`)).concat([appt('x', 'cx', { advisor: 'Xavier Collin' }), appt('y', 'cy', { advisor: 'Anita Andrews' })])
    const t = byPerson(advisorDistribution(appts, ['Joe Nicholls', 'Xavier Collin', 'Cecilia Szabo']))
    expect(t['Joe Nicholls'].appointments).toBe(6)
    expect(t['Joe Nicholls'].share).toBeCloseTo(6 / 7, 10)
    expect('vsEqual' in t['Joe Nicholls']).toBe(false)
    expect([t['Cecilia Szabo'].appointments, t['(not a listed advisor)'].appointments]).toEqual([0, 1])
  })

  it('reports leads added per LOCKED Created By, with appointments and full fact finds', () => {
    const leads = [{ contact_id: 'c1' }, { contact_id: 'c1' }, { contact_id: 'c2' }, { contact_id: 'c3' }]
    const locks = [{ contact_id: 'c1', field: 'created_by', first_value: 'Ava Morris-Boundy' }, { contact_id: 'c2', field: 'created_by', first_value: 'Ava Morris-Boundy' },
      { contact_id: 'c3', field: 'booked_by:e9', first_value: 'Someone' }]
    const rows = createdByReport(leads, locks, [appt('1', 'c1')], { c1: FULL })
    expect(rows).toEqual([
      { person: 'Ava Morris-Boundy', leads: 2, appointments: 1, fullFactFinds: 1 },
      { person: '(not recorded)', leads: 1, appointments: 0, fullFactFinds: 0 },
    ])
  })
})

describe('weeks and the forward view', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart(new Date('2026-10-22T12:00:00Z')).getDay()).toBe(1) // Thursday -> Monday 19 Oct
    expect(weekStart(new Date('2026-10-25T12:00:00Z')).getDate()).toBe(19) // Sunday belongs to the week before
    expect(weekStart(new Date('2026-10-19T00:30:00Z')).getDate()).toBe(19)
  })

  it('buckets bookings per week and keeps empty weeks', () => {
    const appts = [appt('1', 'c1', { booked_at: '2026-10-05T09:00:00Z' }), appt('2', 'c2', { booked_at: '2026-10-21T09:00:00Z', booked_by_official: 'Harry Kalsi' })]
    const { weeks, people } = weeklyBookings(appts, (a) => a.booked_by_official)
    expect(people).toEqual(['Harry Kalsi', 'Hugo Sharpe'])
    expect(weeks.map((w) => w.key)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19'])
    expect([weeks[0]['Hugo Sharpe'], weeks[1]['Hugo Sharpe'], weeks[2]['Harry Kalsi']]).toEqual([1, 0, 1])
  })

  it('shows the coming Monday to Friday, without cancelled or deleted appointments', () => {
    const appts = [
      appt('1', 'c1', { start_time: '2026-10-26T09:00:00Z', status: 'confirmed' }), appt('2', 'c2', { start_time: '2026-10-30T09:00:00Z', status: 'confirmed' }),
      appt('3', 'c3', { start_time: '2026-10-27T09:00:00Z', status: 'cancelled' }), appt('4', 'c4', { start_time: '2026-10-28T09:00:00Z', deleted: 'TRUE' }),
      appt('5', 'c5', { start_time: '2026-10-24T09:00:00Z', status: 'confirmed' }), appt('6', 'c6', { start_time: '2026-11-02T09:00:00Z', status: 'confirmed' }),
    ]
    const { monday, days } = forwardWeek(appts, NOW) // Thursday 22 Oct -> Monday 26 Oct
    expect(monday.getDate()).toBe(26)
    expect(days.map((d) => d.appointments.length)).toEqual([1, 0, 0, 0, 1])
    // from a Friday and from a Sunday the coming Monday is still the 26th / the 26th
    expect(forwardWeek([], new Date('2026-10-23T09:00:00Z')).monday.getDate()).toBe(26)
    expect(forwardWeek([], new Date('2026-10-25T09:00:00Z')).monday.getDate()).toBe(26)
    // and from a Monday it is the Monday after
    expect(forwardWeek([], new Date('2026-10-26T09:00:00Z')).monday.getDate()).toBe(2)
  })
})

describe('date ranges', () => {
  const thursday = new Date('2026-10-22T12:00:00')
  it('has Monday-start weeks and calendar months', () => {
    expect(rangeBounds('week', null, thursday).from.getDate()).toBe(19)
    const last = rangeBounds('lastweek', null, thursday)
    expect([last.from.getDate(), last.to.getDate()]).toEqual([12, 19])
    expect(rangeBounds('month', null, thursday).from.getDate()).toBe(1)
    const lm = rangeBounds('lastmonth', null, thursday)
    expect([lm.from.getMonth(), lm.to.getMonth()]).toEqual([8, 9])
    expect(rangeBounds('all', null, thursday)).toBeNull()
    expect(rangeBounds('custom', { from: null, to: null }, thursday)).toBeNull()
  })

  it('keeps the existing filter behaviour for rolling ranges and custom ranges', () => {
    const rows = [{ created_date: '2026-10-21' }, { created_date: '2026-09-01' }, { created_date: '' }]
    expect(filterByDateRange(rows, '7d', null, thursday)).toHaveLength(1)
    expect(filterByDateRange(rows, 'all', null, thursday)).toHaveLength(3)
    const custom = { from: new Date('2026-09-01T00:00:00'), to: new Date('2026-09-01T00:00:00') }
    expect(filterByDateRange(rows, 'custom', custom, thursday)).toHaveLength(1)
    expect(filterByDateRange(rows, 'lastmonth', null, thursday).map((r) => r.created_date)).toEqual(['2026-09-01'])
  })
})

describe('full fact finds by month', () => {
  it('lists the last six months, oldest first', () => {
    const months = lastMonths(NOW, 6)
    expect(months.map((m) => m.key)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(months[5].label).toBe('Oct 2026')
    expect(lastMonths(new Date('2026-02-10T12:00:00Z'), 3).map((m) => m.key)).toEqual(['2025-12', '2026-01', '2026-02'])
  })

  it('counts a credited full fact find once, in the month of its appointment, per person', () => {
    const appts = [
      appt('1', 'c1', { start_time: '2026-09-10T09:00:00Z', booked_at: '2026-09-01T09:00:00Z' }),
      appt('2', 'c2', { start_time: '2026-10-08T09:00:00Z', advisor: 'Xavier Collin' }),
      appt('3', 'c3', { start_time: '2026-10-09T09:00:00Z' }),                               // advice only: not a full fact find
      appt('4', 'c4', { start_time: '2026-01-09T09:00:00Z', booked_at: '2026-01-01T09:00:00Z' }), // outside the six months
      appt('5', 'c1', { start_time: '2026-10-15T09:00:00Z', booked_at: '2026-10-10T09:00:00Z' }),  // c1's outcome belongs to this later one
    ]
    const contacts = { c1: FULL, c2: FULL, c3: ADVICE, c4: FULL }
    const rows = fullFactFindsByMonth(appts, contacts, NOW, (a) => a.advisor, lastMonths(NOW, 6))
    const joe = rows.find((r) => r.person === 'Joe Nicholls')
    expect(joe.counts['2026-09']).toBe(0)       // credited to the later appointment, not counted twice
    expect(joe.counts['2026-10']).toBe(1)
    expect(joe.total).toBe(1)
    expect(rows.find((r) => r.person === 'Xavier Collin').total).toBe(1)
    expect(rows.map((r) => r.total).reduce((a, b) => a + b, 0)).toBe(2)
    expect(creditedAppointments(appts, contacts, NOW).creditedFf.has('4')).toBe(true)
  })
})

describe('flag columns', () => {
  it('give each flag type its own meaning for Was / Now / Official', () => {
    expect(flagValues({ type: 'created_by_changed', old_value: 'Ava', new_value: 'Hugo', locked_value: 'Ava' })).toEqual({ was: 'Ava', now: 'Hugo', official: 'Ava' })
    expect(flagValues({ type: 'booked_by_missing', old_value: '', new_value: 'Harry', locked_value: 'Harry' })).toEqual({ was: '', now: '', official: 'Harry' })
    expect(flagValues({ type: 'booked_by_mismatch', old_value: 'Harry', new_value: 'Hugo', locked_value: 'Hugo' })).toEqual({ was: '', now: 'Harry', official: 'Hugo' })
    expect(flagValues({ type: 'advisor_mismatch', old_value: 'Xavier', new_value: 'Joe', locked_value: '' })).toEqual({ was: '', now: 'Xavier', official: 'Joe' })
  })
})

describe('date range basis: booked date or appointment date', () => {
  // booked in September, held in October / booked in October, held in November
  const appts = [
    appt('a', 'c1', { booked_at: '2026-09-28T09:00:00Z', start_time: '2026-10-02T09:00:00Z' }),
    appt('b', 'c2', { booked_at: '2026-10-05T09:00:00Z', start_time: '2026-11-03T09:00:00Z', status: 'confirmed' }),
  ]
  const october = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') }

  it('defaults to the booked date and switches to the appointment date on request', () => {
    const booked = byPerson(buildSalesTable(appts, {}, NOW, october))['Hugo Sharpe']
    const held = byPerson(buildSalesTable(appts, {}, NOW, { ...october, dateField: 'start_time' }))['Hugo Sharpe']
    expect([booked.booked, booked.upcoming]).toEqual([1, 1]) // only b was booked in October (and it is in the future)
    expect([held.booked, held.showed, held.upcoming]).toEqual([1, 1, 0]) // only a was held in October
  })

  it('applies the same basis to the advisor distribution and the weekly chart', () => {
    const rr = (dateField) => advisorDistribution(appts, ['Joe Nicholls'], { ...october, dateField }).find((r) => r.person === 'Joe Nicholls').appointments
    expect([rr('booked_at'), rr('start_time')]).toEqual([1, 1])
    const weeks = (dateField) => weeklyBookings(appts, (a) => a.booked_by_official, { ...october, dateField }).weeks.reduce((n, w) => n + w['Hugo Sharpe'], 0)
    expect([weeks('booked_at'), weeks('start_time')]).toEqual([1, 1])
    const firstWeek = weeklyBookings(appts, (a) => a.booked_by_official, { ...october, dateField: 'start_time' }).weeks.find((w) => w['Hugo Sharpe'] === 1)
    expect(firstWeek.key).toBe('2026-09-28') // the week of 2 Oct 2026 starts Monday 28 Sep
  })
})
