import { describe, it, expect } from 'vitest'
import { applyFlagOverrides, pendingOverrides, statusText } from './flags'

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

  it('names the statuses in plain words', () => {
    expect([statusText('open'), statusText('resolved'), statusText('')]).toEqual(['Open', 'Sorted', '—'])
  })
})
