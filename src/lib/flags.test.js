import { describe, it, expect } from 'vitest'
import { applyFlagOverrides, flagPeople, pendingOverrides, statusText } from './flags'

const flags = [
  { flag_id: 'a', status: 'open' },
  { flag_id: 'b', status: 'open' },
  { flag_id: 'c', status: 'resolved' },
]

describe('marking flags sorted', () => {
  it('lays a change made here over the sheet data straight away', () => {
    const out = applyFlagOverrides(flags, new Map([['a', { status: 'resolved', resolved_at: 't' }], ['c', { status: 'open', resolved_at: '' }]]))
    expect(out.map((f) => f.status)).toEqual(['resolved', 'open', 'open'])
    expect(out[0].resolved_at).toBe('t')
    expect(out.filter((f) => f.status === 'open')).toHaveLength(2) // the open count moves with the tick
  })

  it('returns the same list when nothing was changed', () => {
    expect(applyFlagOverrides(flags, new Map())).toBe(flags)
  })

  it('drops an override once the sheet shows the same status, and keeps it while the data is still old', () => {
    const overrides = new Map([['a', { status: 'resolved' }], ['b', { status: 'resolved' }]])
    const caughtUp = [{ flag_id: 'a', status: 'resolved' }, { flag_id: 'b', status: 'open' }]
    expect([...pendingOverrides(caughtUp, overrides).keys()]).toEqual(['b'])
  })

  it('drops an override for a flag that is no longer in the data', () => {
    expect(pendingOverrides([], new Map([['x', { status: 'resolved' }]])).size).toBe(0)
  })

  it('lays a saved note over the sheet data without touching the status, and the other way round', () => {
    const out = applyFlagOverrides(flags, new Map([['a', { note: 'Rang back on mobile', noted_at: 't' }], ['b', { status: 'resolved', resolved_at: 'u' }]]))
    expect(out[0]).toMatchObject({ status: 'open', note: 'Rang back on mobile', noted_at: 't' })
    expect(out[1]).toMatchObject({ status: 'resolved', resolved_at: 'u' })
    expect(out[1].note).toBeUndefined()
  })

  it('keeps a note override until the sheet shows the same note', () => {
    const overrides = new Map([['a', { note: 'x' }], ['b', { note: '' }]])
    const data = [{ flag_id: 'a', status: 'open', note: '' }, { flag_id: 'b', status: 'open' }]
    expect([...pendingOverrides(data, overrides).keys()]).toEqual(['a']) // b: a cleared note matches a missing column
  })

  it('keeps an override that changed both until both have caught up', () => {
    const overrides = new Map([['a', { status: 'resolved', note: 'x' }]])
    expect(pendingOverrides([{ flag_id: 'a', status: 'resolved', note: '' }], overrides).size).toBe(1)
    expect(pendingOverrides([{ flag_id: 'a', status: 'resolved', note: 'x' }], overrides).size).toBe(0)
  })

  it('names the owner from the lead and prefers the appointment advisor', () => {
    expect(flagPeople({ admin: 'Ben Robertson', advisor_name: 'Joe Nicholls' }, { advisor: 'Xavier Collin' })).toEqual({ owner: 'Ben Robertson', advisor: 'Xavier Collin' })
    expect(flagPeople({ admin: 'Ben Robertson', advisor_name: 'Joe Nicholls' }, undefined)).toEqual({ owner: 'Ben Robertson', advisor: 'Joe Nicholls' })
    expect(flagPeople(undefined, undefined)).toEqual({ owner: '', advisor: '' })
  })

  it('names the statuses in plain words', () => {
    expect([statusText('open'), statusText('resolved'), statusText('')]).toEqual(['Open', 'Sorted', '—'])
  })
})
