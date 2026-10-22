process.env.TZ = 'Europe/London'

import { describe, it, expect } from 'vitest'
import { STAGE_ORDER, stageIndex, stageAtOrBeyond, isStuck, EXPECTED_ADMINS, isAnomalousAdmin, productEndDate, isFindingPropertyCase, attachAppointmentStart, ercForecast } from './metrics'

// The pipeline as GHL returns it (checked live on 22 Oct 2026), minus Lost which is deliberately not in STAGE_ORDER.
const LIVE = [
  'Lead Received', 'Client Contacted', 'Appointment Booked', 'Post Appointment', 'Interested / Not Ready', 'Docs Requested',
  'Docs Received / Full Review', 'Advisor Recommendation', 'Awaiting Client Response', 'Solicitor / Application Prep',
  'Application Submitted', 'Lender Processing', 'Offer Issued', 'Exchange', 'Completion', 'Post Completion',
]

describe('stage model', () => {
  it('is exactly the live GHL pipeline order', () => {
    expect(STAGE_ORDER).toEqual(LIVE)
  })

  it('knows the renamed and the new stage', () => {
    expect(stageIndex('Client Contacted')).toBe(1)
    expect(stageIndex('Admin Contacted')).toBe(-1) // the old name no longer exists
    expect(stageIndex('Post Appointment')).toBe(3)
    expect(stageAtOrBeyond({ pipeline_stage: 'Post Appointment' }, 'Appointment Booked')).toBe(true)
    expect(stageAtOrBeyond({ pipeline_stage: 'Appointment Booked' }, 'Post Appointment')).toBe(false)
    expect(stageAtOrBeyond({ pipeline_stage: 'Lost' }, 'Lead Received')).toBe(false) // a lost case never counts as having progressed
  })

  it('still treats the first three stages as the stuck window', () => {
    const old = { case_status: 'open', created_date: '2026-06-01' }
    const now = new Date('2026-10-22T12:00:00Z')
    for (const stage of ['Lead Received', 'Client Contacted', 'Appointment Booked']) expect(isStuck({ ...old, pipeline_stage: stage }, now)).toBe(true)
    for (const stage of ['Post Appointment', 'Docs Requested', 'Interested / Not Ready']) expect(isStuck({ ...old, pipeline_stage: stage }, now)).toBe(false)
  })

  it('keeps the finding-property rule working after the stage insert', () => {
    const base = { case_status: 'open', property_status: 'Buy-to-let' }
    expect(isFindingPropertyCase({ ...base, pipeline_stage: 'Post Appointment' })).toBe(true)
    expect(isFindingPropertyCase({ ...base, pipeline_stage: 'Offer Issued' })).toBe(false)
  })
})

describe('expected case owners', () => {
  it('include the three sales reps the S1 workflow assigns, plus the original four', () => {
    for (const name of ['Ava Morris-Boundy', 'Harry Kalsi', 'Hugo Sharpe', 'Anita Andrews', 'Ben Robertson', 'Lewis Flude', 'Alison Gulliver']) {
      expect(EXPECTED_ADMINS).toContain(name)
      expect(isAnomalousAdmin(name)).toBe(false)
    }
    expect(isAnomalousAdmin('Someone Else')).toBe(true)
    expect(isAnomalousAdmin('')).toBe(false)
  })
})

describe('product end date', () => {
  it('is the ERC Date, falling back to the older roll-off date only when the ERC Date is empty', () => {
    expect(productEndDate({ erc_date: '2029-10-23', mortgage_product_roll_off_date: '2028-01-01' })).toBe('2029-10-23')
    expect(productEndDate({ erc_date: '', mortgage_product_roll_off_date: '2028-01-01' })).toBe('2028-01-01')
    expect(productEndDate({ erc_date: '   ', mortgage_product_roll_off_date: '2028-01-01' })).toBe('2028-01-01')
    expect(productEndDate({ erc_date: '', mortgage_product_roll_off_date: '' })).toBe('')
  })
})

describe('stuck cases at Appointment Booked', () => {
  const now = new Date('2026-10-22T12:00:00Z')
  const base = { case_status: 'open', created_date: '2026-06-01', pipeline_stage: 'Appointment Booked' }

  it('are only flagged once the appointment date has passed', () => {
    expect(isStuck({ ...base, __appt_start: Date.parse('2026-10-30T10:00:00Z') }, now)).toBe(false) // in the future: not stuck
    expect(isStuck({ ...base, __appt_start: Date.parse('2026-10-20T10:00:00Z') }, now)).toBe(true) // passed, still here
  })

  it('fall back to the age rule when no calendar appointment is known, and leave the other early stages alone', () => {
    expect(isStuck(base, now)).toBe(true)
    expect(isStuck({ ...base, pipeline_stage: 'Lead Received', __appt_start: Date.parse('2026-10-30T10:00:00Z') }, now)).toBe(true)
  })
})

describe('attachAppointmentStart', () => {
  const appt = (o) => ({ contact_id: 'c1', booked_at: '2026-10-01T09:00:00Z', start_time: '2026-10-05T10:00:00Z', status: 'confirmed', deleted: '', ...o })

  it('uses the latest booked live appointment and ignores cancelled and deleted ones', () => {
    const rows = [{ contact_id: 'c1' }, { contact_id: 'c2' }]
    const out = attachAppointmentStart(rows, [
      appt({}),
      appt({ booked_at: '2026-10-10T09:00:00Z', start_time: '2026-10-15T10:00:00Z' }),
      appt({ booked_at: '2026-10-12T09:00:00Z', start_time: '2026-10-20T10:00:00Z', status: 'cancelled' }),
      appt({ booked_at: '2026-10-13T09:00:00Z', start_time: '2026-10-25T10:00:00Z', deleted: '1' }),
    ])
    expect(out[0].__appt_start).toBe(Date.parse('2026-10-15T10:00:00Z'))
    expect(out[1].__appt_start).toBeUndefined()
  })

  it('returns the rows untouched when there is no calendar data', () => {
    const rows = [{ contact_id: 'c1' }]
    expect(attachAppointmentStart(rows, [])).toBe(rows)
  })
})

describe('ERC renewal forecast', () => {
  const now = new Date(2026, 9, 22) // 22 Oct 2026, local
  const r = (id, erc, advisor = 'Joe Nicholls') => ({ contact_id: id, erc_date: erc, advisor_name: advisor })

  it('buckets product end dates by month from today to the end of next year', () => {
    const f = ercForecast([r('a', '2026-10-21'), r('b', '2026-10-22'), r('c', '2026-12-31'), r('d', '2027-03-15'), r('e', '2027-12-31'), r('f', '2028-01-01'), r('g', '')], now)
    expect(f.months[0].key).toBe('2026-10')
    expect(f.months.at(-1).key).toBe('2027-12')
    expect(f.months).toHaveLength(15)
    expect(f.months[0].rows.map((x) => x.contact_id)).toEqual(['b']) // yesterday's end date has passed, today's counts
    expect(f.total).toBe(4) // b, c, d, e
    expect(f.nextYear.map((x) => x.contact_id)).toEqual(['d', 'e'])
    expect(f.nextYearNo).toBe(2027)
  })

  it('next 6 months stops before the same day six months on, and the advisor filter narrows everything', () => {
    const rows = [r('a', '2027-04-21'), r('b', '2027-04-22', 'Xavier Collin'), r('c', '2027-01-10', 'Xavier Collin')]
    expect(ercForecast(rows, now).next6.map((x) => x.contact_id)).toEqual(['a', 'c']) // b ends exactly six months on: not inside the window
    const x = ercForecast(rows, now, 'Xavier Collin')
    expect(x.total).toBe(2)
    expect(x.next6.map((y) => y.contact_id)).toEqual(['c'])
  })

  it('treats exactly six months on as outside the next-6-months window (compared at local midnight)', () => {
    const edge = new Date(2027, 3, 22).toISOString()
    expect(ercForecast([r('edge', edge)], now).next6).toHaveLength(0)
    expect(ercForecast([r('edge', new Date(2027, 3, 21).toISOString())], now).next6).toHaveLength(1)
  })

  it('falls back to the older roll-off date when there is no ERC Date', () => {
    expect(ercForecast([{ contact_id: 'z', erc_date: '', mortgage_product_roll_off_date: '2027-02-02' }], now).total).toBe(1)
  })
})
