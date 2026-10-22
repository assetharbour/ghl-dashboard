import { describe, it, expect } from 'vitest'
import { createdByLocks } from './_locks.js'

const HEADER = ['contact_id', 'field', 'first_value', 'first_seen_at', 'current_value', 'current_seen_at']

describe('createdByLocks', () => {
  it('keeps only the Created By rows and only the columns the dashboard needs', () => {
    const out = createdByLocks([
      HEADER,
      ['c1', 'created_by', 'Ava Morris-Boundy', '2026-10-22T12:00:00Z', 'Hugo Sharpe', '2026-10-23T12:00:00Z'],
      ['c2', 'booked_by:e1', 'Harry Kalsi', '2026-10-22T12:00:00Z', 'Harry Kalsi', '2026-10-22T12:00:00Z'],
      ['c3', 'created_by', 'Hugo Sharpe', '2026-10-22T12:00:00Z', 'Hugo Sharpe'],
    ])
    expect(out).toEqual([
      ['contact_id', 'field', 'first_value', 'first_seen_at', 'current_value'],
      ['c1', 'created_by', 'Ava Morris-Boundy', '2026-10-22T12:00:00Z', 'Hugo Sharpe'],
      ['c3', 'created_by', 'Hugo Sharpe', '2026-10-22T12:00:00Z', 'Hugo Sharpe'],
    ])
  })

  it('returns nothing for a missing tab or a tab without the expected columns', () => {
    expect(createdByLocks([])).toEqual([])
    expect(createdByLocks([['a', 'b']])).toEqual([])
  })
})
