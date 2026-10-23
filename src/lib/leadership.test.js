process.env.TZ = 'Europe/London'

import { describe, it, expect } from 'vitest'
import {
  median, rank, completedInRange, speedSummary, fmtMinutes, salesBoard, advisorBoard, adminBoard, introducerBoard, funnel, weeklyTrend, headline, honours,
  MIN_LEADS_FOR_SPEED, HANDOVER_ADMINS,
} from './leadership'
import { contactInfoFromLeads } from './sales'

const NOW = new Date('2026-10-23T12:00:00Z') // a Friday

// ----------------------------------------------------------------------------------------------------------- helpers
const lead = (o = {}) => ({
  contact_id: 'c' + Math.random(), pipeline_stage: 'Lead Received', case_status: 'open', created_date: '2026-10-20', lead_source: 'Website',
  advisor_name: '', admin: '', total_revenue: '', completion_date: '', docs_status: '', ...o,
})
const appt = (id, o = {}) => ({
  appointment_id: id, contact_id: 'ct-' + id, booked_by_official: 'Hugo Sharpe', advisor: 'Joe Nicholls', booked_at: '2026-10-20T09:00:00Z',
  start_time: '2026-10-21T09:00:00Z', status: 'showed', deleted: '', ...o,
})
const speedRow = (o = {}) => ({
  opportunity_id: 'o' + Math.random(), created_at: '2026-10-20T09:00:00Z', status: 'called', first_call_by: 'Hugo Sharpe',
  minutes_to_first_call: '4', minutes_to_first_connect: '9', ...o,
})
const EMPTY_SPEED = speedSummary([])

describe('small helpers', () => {
  it('median ignores non-numbers and handles odd, even and empty lists', () => {
    expect([median([3, 1, 2]), median([4, 1, 3, 2]), median([]), median([NaN, 5]), median([7])]).toEqual([2, 2.5, null, 5, 7])
  })

  it('rank orders by the primary metric, breaks ties with the second, shares a place on a full tie and puts blanks last', () => {
    const rows = [{ name: 'B', a: 5, b: 1 }, { name: 'A', a: 5, b: 1 }, { name: 'C', a: 5, b: 9 }, { name: 'D', a: null, b: 0 }, { name: 'E', a: 2, b: 0 }, { name: 'Z', a: 0, b: 0 }]
    const out = rank(rows, (r) => r.a, (r) => r.b)
    expect(out.map((r) => [r.name, r.place])).toEqual([['C', 1], ['A', 2], ['B', 2], ['E', 4], ['Z', 5], ['D', 6]]) // a real zero beats a blank
  })

  it('formats minutes for people', () => {
    expect([null, 0.4, 4.6, 59.4, 90, 600, 1440, 3000].map(fmtMinutes)).toEqual(['—', '<1 min', '5 min', '59 min', '1.5 h', '10 h', '1.0 days', '2.1 days'])
  })
})

describe('speed to lead', () => {
  const start = new Date('2026-10-19T00:00:00Z')
  const end = new Date('2026-10-24T00:00:00Z')

  it('uses leads created in the range, counts uncalled leads as misses and leaves out waiting and no-phone leads', () => {
    const rows = [
      speedRow({ minutes_to_first_call: '3' }), speedRow({ minutes_to_first_call: '12' }), speedRow({ minutes_to_first_call: '45' }),
      speedRow({ minutes_to_first_call: '200' }), speedRow({ minutes_to_first_call: '900' }),
      speedRow({ status: 'not_called', first_call_by: '', minutes_to_first_call: '', minutes_to_first_connect: '' }),
      speedRow({ status: 'waiting', first_call_by: '', minutes_to_first_call: '' }), speedRow({ status: 'no_phone', first_call_by: '', minutes_to_first_call: '' }),
      speedRow({ created_at: '2026-10-01T09:00:00Z' }), // outside the range
    ]
    const s = speedSummary(rows, start, end)
    expect([s.leads, s.called, s.notCalled, s.waiting, s.noPhone]).toEqual([6, 5, 1, 1, 1])
    expect(s.median).toBe(45)
    expect([s.withinFifteen, s.pctWithinFifteen]).toEqual([2, 2 / 6])
    expect(s.buckets.map((b) => b.count)).toEqual([1, 1, 1, 1, 1]) // 3, 12, 45, 200, 900 minutes
    expect(s.medianConnect).toBe(9)
  })

  it('puts a call at exactly a bucket limit in that bucket', () => {
    const s = speedSummary([5, 15, 60, 240, 241].map((m) => speedRow({ minutes_to_first_call: String(m) })))
    expect(s.buckets.map((b) => b.count)).toEqual([1, 1, 1, 1, 1])
    expect(s.withinFifteen).toBe(2) // 5 and exactly 15 minutes
  })

  it('works out the median per first caller and only trusts it from three leads', () => {
    const rows = [
      ...[2, 4, 6].map((m) => speedRow({ first_call_by: 'Hugo Sharpe', minutes_to_first_call: String(m) })),
      ...[30, 50].map((m) => speedRow({ first_call_by: 'Ava Mae Morris-Boundy', minutes_to_first_call: String(m) })),
    ]
    const s = speedSummary(rows)
    const hugo = s.byCaller.find((c) => c.name === 'Hugo Sharpe')
    const ava = s.byCaller.find((c) => c.name.startsWith('Ava'))
    expect([hugo.leads, hugo.median, hugo.enough, hugo.onSalesTeam, hugo.withinFifteen]).toEqual([3, 4, true, true, 3])
    expect([ava.leads, ava.median, ava.enough, ava.onSalesTeam]).toEqual([2, 40, false, true])
    expect(MIN_LEADS_FOR_SPEED).toBe(3)
  })

  it('copes with no rows', () => {
    expect([EMPTY_SPEED.leads, EMPTY_SPEED.median, EMPTY_SPEED.pctWithinFifteen, EMPTY_SPEED.byCaller.length]).toEqual([0, null, null, 0])
  })
})

describe('sales board', () => {
  const appointments = [
    appt('1'), appt('2'), appt('3', { status: 'noshow' }),
    appt('4', { booked_by_official: 'Ava Morris-Boundy' }), appt('5', { booked_by_official: 'Harry Kalsi', status: 'cancelled' }),
    appt('6', { booked_by_official: 'Sarah Bennett' }),
  ]
  const callActivity = [
    { day: '2026-10-21', caller: 'Hugo Sharpe', calls: '30', connected: '20', conversations: '8', long_calls: '1', no_answer: '10', talk_seconds: '2000' },
    { day: '2026-10-21', caller: 'Ava Mae Morris-Boundy', calls: '50', connected: '8', conversations: '4', long_calls: '0', no_answer: '2', talk_seconds: '500' },
  ]
  const speed = speedSummary([...[2, 4, 6].map((m) => speedRow({ first_call_by: 'Hugo Sharpe', minutes_to_first_call: String(m) })), ...[1, 2].map((m) => speedRow({ first_call_by: 'Ava Mae Morris-Boundy', minutes_to_first_call: String(m) }))])
  const board = salesBoard({ appointments, contacts: {}, now: NOW, start: null, end: null, callActivity, speed })

  it('lists exactly the three sales people, ranked by appointments booked', () => {
    expect(board.map((r) => [r.name, r.place, r.booked])).toEqual([['Hugo Sharpe', 1, 3], ['Ava Morris-Boundy', 2, 1], ['Harry Kalsi', 3, 1]]) // Ava and Harry tie on bookings; Ava's showed
    expect(board.find((r) => r.name === 'Sarah Bennett')).toBeUndefined() // not on the sales team
  })

  it('carries show rate, calls, calls per booking and speed, and shows zeros for someone with nothing', () => {
    const hugo = board.find((r) => r.name === 'Hugo Sharpe')
    expect([hugo.showed, hugo.noShow, hugo.calls, hugo.conversations]).toEqual([2, 1, 30, 8])
    expect(hugo.showRate).toBeCloseTo(2 / 3, 10)
    expect(hugo.callsPerBooking).toBe(10)
    expect(board.find((r) => r.name.startsWith('Ava')).place).toBe(2) // ranked by bookings, not by the 50 calls
    expect([hugo.speedMedian, hugo.speedLeads]).toEqual([4, 3])
    const harry = board.find((r) => r.name === 'Harry Kalsi')
    expect([harry.calls, harry.callsPerBooking, harry.speedMedian, harry.speedLeads]).toEqual([0, null, null, 0])
    const ava = board.find((r) => r.name.startsWith('Ava'))
    expect([ava.calls, ava.speedMedian]).toEqual([50, null]) // calls matched by Evonex's spelling of the name; two first calls are not enough for a speed figure
  })

  it('respects the date range', () => {
    const only = salesBoard({ appointments, contacts: {}, now: NOW, start: new Date(2026, 9, 21), end: null, callActivity, speed: EMPTY_SPEED })
    expect(only.every((r) => r.booked === 0)).toBe(true)
    const hugoOnly = only.find((r) => r.name === 'Hugo Sharpe')
    expect([hugoOnly.calls, hugoOnly.callsPerBooking]).toEqual([30, null]) // calls but no bookings: no ratio, never infinity
  })
})

describe('completions are counted when they completed', () => {
  it('uses the completion date inside the range, and every completion when there is no range', () => {
    const done = lead({ pipeline_stage: 'Completion', completion_date: '2026-10-10' })
    const start = new Date('2026-10-01T00:00:00Z')
    expect(completedInRange(done, start, new Date('2026-11-01T00:00:00Z'))).toBe(true)
    expect(completedInRange(done, new Date('2026-10-11T00:00:00Z'), null)).toBe(false)
    expect(completedInRange(done, null, new Date('2026-10-10T00:00:00Z'))).toBe(false) // end is exclusive
    expect(completedInRange({ ...done, completion_date: '' }, start, null)).toBe(false) // no date: cannot be placed in a period
    expect(completedInRange({ ...done, completion_date: '' }, null, null)).toBe(true) // but All time counts it
    expect(completedInRange(lead({ pipeline_stage: 'Post Completion', completion_date: '2026-10-10' }), start, null)).toBe(false)
  })
})

describe('advisor board', () => {
  const all = [
    lead({ advisor_name: 'Joe Nicholls', pipeline_stage: 'Completion', total_revenue: '1000', created_date: '2026-06-01', completion_date: '2026-10-01' }),
    lead({ advisor_name: 'Joe Nicholls', pipeline_stage: 'Completion', total_revenue: '500', created_date: '2026-09-11', completion_date: '2026-10-21' }),
    lead({ advisor_name: 'Joe Nicholls', pipeline_stage: 'Completion', total_revenue: '800', created_date: '2026-01-01', completion_date: '2026-03-01' }), // completed long ago
    lead({ advisor_name: 'Joe Nicholls' }), lead({ advisor_name: 'Joe Nicholls', pipeline_stage: 'Docs Requested' }),
    lead({ advisor_name: 'Xavier Collin', pipeline_stage: 'Completion', total_revenue: '', completion_date: '2026-10-05' }), lead({ advisor_name: 'Xavier Collin' }),
    lead({ advisor_name: 'Cecilia Szabo' }),
    lead({ advisor_name: '' }),
  ]
  const appointments = [appt('a'), appt('b', { advisor: 'Xavier Collin' }), appt('c', { advisor: 'Nobody Listed' })]
  const range = { start: new Date('2026-10-01T00:00:00Z'), end: null }
  const board = advisorBoard({ rows: all.filter((r) => r.created_date >= '2026-10-01'), allRows: all, appointments, contacts: {}, now: NOW, ...range })

  it('ranks by completions in the period then leads assigned, drops advisors with nothing and ignores people who are not advisors', () => {
    expect(board.map((r) => [r.name, r.place, r.completions])).toEqual([['Joe Nicholls', 1, 2], ['Xavier Collin', 2, 1], ['Cecilia Szabo', 3, 0]])
  })

  it('counts a case that completed in the period whatever its age, and ignores one that completed before it', () => {
    const joe = board[0]
    expect([joe.completions, joe.revenue, joe.assigned]).toEqual([2, 1500, 2]) // 2 completed in October; the March one is not counted; 2 leads created this month
    expect(joe.avgDays).toBeCloseTo((122 + 40) / 2, 0)
    expect([joe.appointments, joe.showed]).toEqual([1, 1])
    expect(board[1].revenue).toBe(0) // a blank fee is not counted as money
  })

  it('counts every completion with no date range', () => {
    const everything = advisorBoard({ rows: all, allRows: all, appointments, contacts: {}, now: NOW, start: null, end: null })
    expect(everything[0].completions).toBe(3)
    expect(everything[0].revenue).toBe(2300)
  })
})

describe('handover team board', () => {
  const all = [
    lead({ admin: 'Anita Andrews', pipeline_stage: 'Completion', case_status: 'won', total_revenue: '200', created_date: '2026-08-01', completion_date: '2026-10-12' }),
    lead({ admin: 'Anita Andrews', pipeline_stage: 'Application Submitted' }), lead({ admin: 'Anita Andrews', created_date: '2026-06-01' }),
    lead({ admin: 'Ben Robertson', pipeline_stage: 'Offer Issued' }), lead({ admin: 'Ben Robertson', docs_status: 'Pending' }),
    lead({ admin: 'Ben Robertson', pipeline_stage: 'Completion', case_status: 'won', completion_date: '2026-05-01' }),
    lead({ admin: 'Sarah Bennett', pipeline_stage: 'Completion', case_status: 'won', completion_date: '2026-10-02' }), lead({ admin: 'Harry Kalsi' }), lead({ admin: '' }),
  ]
  const board = adminBoard({ allRows: all, now: NOW, start: new Date('2026-10-01T00:00:00Z'), end: null })
  it('ranks only the four handover admins by completions in the period, then by open cases already at an application', () => {
    expect(HANDOVER_ADMINS).toHaveLength(4)
    expect(board.map((r) => [r.name, r.place, r.completions])).toEqual([['Anita Andrews', 1, 1], ['Ben Robertson', 2, 0]])
    const anita = board[0]
    expect([anita.open, anita.progressed, anita.revenue]).toEqual([2, 1, 200])
    expect(anita.avgDays).toBe(72)
    expect([board[1].open, board[1].awaitingClient, board[1].progressed]).toEqual([2, 1, 1])
  })

  it('shows what each person holds now whatever the range, and drops someone only when they hold nothing and completed nothing in the period', () => {
    const nothing = adminBoard({ allRows: [lead({ admin: 'Lewis Flude', pipeline_stage: 'Completion', case_status: 'won', completion_date: '2026-01-01' })], now: NOW, start: new Date('2026-10-01T00:00:00Z'), end: null })
    expect(nothing).toEqual([])
    const only = adminBoard({ allRows: [lead({ admin: 'Lewis Flude', pipeline_stage: 'Completion', case_status: 'won', completion_date: '2026-10-09' })], now: NOW, start: new Date('2026-10-01T00:00:00Z'), end: null })
    expect(only.map((r) => [r.name, r.open, r.completions])).toEqual([['Lewis Flude', 0, 1]]) // completed something this period but holds nothing now: still listed
  })
})

describe('introducers, funnel, trend, headline and honours', () => {
  it('ranks introducers by recorded revenue then completions and keeps the top five', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => lead({ lead_source: 'Alpha', pipeline_stage: 'Completion', total_revenue: '100' })), lead({ lead_source: 'Alpha' }),
      lead({ lead_source: 'Beta', total_revenue: '900' }), lead({ lead_source: 'Gamma' }), lead({ lead_source: '  ' }),
      ...['D', 'E', 'F', 'G'].map((s) => lead({ lead_source: s })),
    ]
    const top = introducerBoard(rows, 5)
    expect(top).toHaveLength(5)
    expect(top.slice(0, 2).map((r) => [r.name, r.revenue, r.leads, r.completions])).toEqual([['Beta', 900, 1, 0], ['Alpha', 300, 4, 3]])
    expect(top.some((r) => r.name.trim() === '')).toBe(false)
    expect(top[1].conversion).toBe(0.75)
  })

  it('counts how many leads reached each stage and treats lost leads as not progressed', () => {
    const rows = [
      lead(), lead({ pipeline_stage: 'Appointment Booked' }), lead({ pipeline_stage: 'Docs Requested' }), lead({ pipeline_stage: 'Application Submitted' }),
      lead({ pipeline_stage: 'Completion' }), lead({ pipeline_stage: 'Lost', case_status: 'lost' }),
    ]
    const f = funnel(rows)
    expect(f.map((s) => s.count)).toEqual([6, 4, 3, 2, 1, 1])
    expect(f[0].pctOfLeads).toBe(1)
    expect(f[5].pctOfLeads).toBeCloseTo(1 / 6, 10)
    expect(funnel([]).map((s) => s.count)).toEqual([0, 0, 0, 0, 0, 0])
    const withPost = funnel([lead({ pipeline_stage: 'Completion' }), lead({ pipeline_stage: 'Post Completion' })])
    expect(withPost.map((s) => s.count)).toEqual([2, 2, 2, 2, 2, 1]) // Post Completion passed every stage but is not a "Completion", as on the other pages
    expect(funnel([])[1].pctOfLeads).toBeNull()
  })

  it('builds twelve Monday-start weeks of leads, appointments and completions and ignores anything outside them', () => {
    const rows = [
      lead({ created_date: '2026-10-20' }), lead({ created_date: '2026-10-21' }), lead({ created_date: '2026-10-12' }), lead({ created_date: '2025-01-01' }),
      lead({ created_date: '2026-09-01', pipeline_stage: 'Completion', completion_date: '2026-10-22' }),
      lead({ created_date: '2026-09-01', pipeline_stage: 'Docs Requested', completion_date: '2026-10-22' }), // not completed: not counted
    ]
    const t = weeklyTrend({ allRows: rows, appointments: [appt('1', { booked_at: '2026-10-21T09:00:00Z' }), appt('2', { deleted: 'TRUE' })], now: NOW })
    expect(t).toHaveLength(12)
    expect(t.at(-1).key).toBe('2026-10-19') // the Monday of the week of Fri 23 Oct
    expect(t.at(-1)).toMatchObject({ leads: 2, appointments: 1, completions: 1 })
    expect(t.at(-2)).toMatchObject({ leads: 1, appointments: 0, completions: 0 })
    expect(t.reduce((n, w) => n + w.leads, 0)).toBe(3 + 2) // the 2025 lead is outside; the two September leads were created in week 2026-08-31, also outside
  })

  it('headline numbers: cohort leads, calendar appointments, completions in the period, recorded revenue only', () => {
    const rows = [lead({ pipeline_stage: 'Completion', total_revenue: '700', created_date: '2026-10-01', completion_date: '2026-10-11' }), lead({ total_revenue: '300' }), lead()]
    const allRows = [...rows, lead({ pipeline_stage: 'Completion', created_date: '2026-03-01', completion_date: '2026-10-15', total_revenue: '5000' }), lead({ pipeline_stage: 'Completion', created_date: '2026-03-01', completion_date: '2026-02-15' })]
    const range = { start: new Date('2026-10-01T00:00:00Z'), end: null }
    const h = headline({ rows, allRows, appointments: [appt('1'), appt('2', { status: 'noshow' }), appt('3', { status: 'cancelled' })], contacts: {}, now: NOW, ...range, speed: EMPTY_SPEED })
    expect([h.leads, h.booked, h.completions, h.revenue, h.revenueRecorded]).toEqual([3, 3, 2, 1000, 2]) // the old lead that completed this month counts; the February one does not; revenue is for the leads received in the period
    expect(h.showRate).toBeCloseTo(1 / 2, 10) // 1 showed of the 2 due (the cancelled one is not due)
    expect(h.avgDays).toBeCloseTo((10 + 228) / 2, 0)
    expect(h.speedMedian).toBeNull()
  })

  it('names a winner only when someone has actually earned it', () => {
    const none = honours({ sales: [{ name: 'A', booked: 0 }], advisors: [], admins: [{ name: 'B', completions: 0 }], introducers: [{ name: 'C', revenue: 0 }], speed: EMPTY_SPEED })
    expect(none).toEqual({ booker: null, responder: null, advisor: null, admin: null, introducer: null })
    const speed = speedSummary([...[2, 4, 6].map((m) => speedRow({ first_call_by: 'Hugo Sharpe', minutes_to_first_call: String(m) })), ...[1, 1].map((m) => speedRow({ first_call_by: 'Ava Mae Morris-Boundy', minutes_to_first_call: String(m) })), ...[20, 30, 40].map((m) => speedRow({ first_call_by: 'Harry Kalsi', minutes_to_first_call: String(m) }))])
    const some = honours({
      sales: [{ name: 'Hugo Sharpe', booked: 9 }], advisors: [{ name: 'Joe Nicholls', completions: 4 }], admins: [{ name: 'Anita Andrews', completions: 2 }],
      introducers: [{ name: 'Alpha', revenue: 800 }], speed,
    })
    expect(some).toEqual({
      booker: { name: 'Hugo Sharpe', value: 9 }, responder: { name: 'Hugo Sharpe', value: 4, leads: 3 }, advisor: { name: 'Joe Nicholls', value: 4 },
      admin: { name: 'Anita Andrews', value: 2 }, introducer: { name: 'Alpha', value: 800 },
    }) // Ava was faster but only has two leads behind it
  })

  it('reuses the contact info the Sales page builds', () => {
    expect(contactInfoFromLeads([]).constructor).toBe(Object)
  })
})
