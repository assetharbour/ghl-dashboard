// Call evidence and call activity helpers (the matching itself is tested in ghl-reporting-sync/tests/test_call_evidence.py).
process.env.TZ = 'Europe/London'

import { describe, it, expect } from 'vitest'
import { callActivityTable, evidenceById, evidenceSummary, fmtTalk, isConversation, RESULT_LABEL } from './calls'
import { flagValues, typeLabel } from './flags'

describe('talk time', () => {
  it('formats seconds as m:ss and h:mm:ss', () => {
    expect([0, 5, 65, 600, 3599, 3600, 3725].map(fmtTalk)).toEqual(['0:00', '0:05', '1:05', '10:00', '59:59', '1:00:00', '1:02:05'])
    expect([fmtTalk(''), fmtTalk(undefined), fmtTalk('x'), fmtTalk(-3)]).toEqual(['0:00', '0:00', '0:00', '0:00'])
  })
})

describe('evidence summary', () => {
  const d = (id, result) => ({ id, __evidence: result ? { result } : null })
  it('splits judged appointments by what the phone records show and ignores unjudged ones', () => {
    const rows = [d(1, 'long_call'), d(2, 'conversation'), d(3, 'short_call'), d(4, 'not_answered'), d(5, 'no_call'), d(6, 'other_caller'), d(7, 'no_phone'), d(8, null)]
    const s = evidenceSummary(rows)
    expect(s.judged).toHaveLength(7)
    expect(s.talked.map((r) => r.id)).toEqual([1, 2])
    expect(s.noConversation.map((r) => r.id)).toEqual([3, 4, 5])
    expect(s.noCall.map((r) => r.id)).toEqual([5])
    expect(s.other.map((r) => r.id)).toEqual([6, 7])
    expect([isConversation('long_call'), isConversation('conversation'), isConversation('short_call')]).toEqual([true, true, false])
    expect(Object.keys(RESULT_LABEL)).toHaveLength(7)
  })

  it('indexes evidence by appointment id', () => {
    expect(evidenceById([{ appointment_id: 'a', result: 'no_call' }]).get('a').result).toBe('no_call')
    expect(evidenceById(undefined).size).toBe(0)
  })
})

describe('call activity table', () => {
  const act = [
    { day: '2026-10-20', caller: 'Ava Mae Morris-Boundy', calls: '10', connected: '6', conversations: '3', long_calls: '1', no_answer: '4', talk_seconds: '900' },
    { day: '2026-10-21', caller: 'Ava Mae Morris-Boundy', calls: '5', connected: '5', conversations: '5', long_calls: '0', no_answer: '0', talk_seconds: '600' },
    { day: '2026-10-21', caller: 'Joe Nicholls', calls: '4', connected: '2', conversations: '1', long_calls: '1', no_answer: '2', talk_seconds: '2000' },
    { day: '2026-10-25', caller: 'Joe Nicholls', calls: '9', connected: '9', conversations: '9', long_calls: '9', no_answer: '0', talk_seconds: '9' },
  ]
  const team = ['Ava Morris-Boundy', 'Harry Kalsi', 'Hugo Sharpe']

  it('adds the days inside the range per caller, end exclusive', () => {
    const t = callActivityTable(act, new Date(2026, 9, 20), new Date(2026, 9, 22), { salesTeam: team, bookedByPerson: { 'Ava Morris-Boundy': 5 } })
    const ava = t.find((r) => r.caller.startsWith('Ava'))
    expect([ava.calls, ava.connected, ava.conversations, ava.longCalls, ava.noAnswer, ava.talkSeconds]).toEqual([15, 11, 8, 1, 4, 1500])
    expect(ava.answerRate).toBeCloseTo(11 / 15, 10)
    expect(t.map((r) => r.caller)).toEqual(['Ava Mae Morris-Boundy', 'Joe Nicholls']) // sorted by calls; the 25th is outside the range
    expect(t.find((r) => r.caller === 'Joe Nicholls').calls).toBe(4)
  })

  it('works out calls per appointment booked for the sales team only, matching names the way Evonex spells them', () => {
    const t = callActivityTable(act, null, null, { salesTeam: team, bookedByPerson: { 'Ava Morris-Boundy': 5, 'Hugo Sharpe': 0 } })
    const ava = t.find((r) => r.caller.startsWith('Ava'))
    expect([ava.onTeam, ava.booked, ava.callsPerBooking]).toEqual([true, 5, 3])
    const joe = t.find((r) => r.caller === 'Joe Nicholls')
    expect([joe.onTeam, joe.booked, joe.callsPerBooking]).toEqual([false, null, null])
    const none = callActivityTable(act, null, null, { salesTeam: team, bookedByPerson: {} }).find((r) => r.caller.startsWith('Ava'))
    expect([none.booked, none.callsPerBooking]).toEqual([0, null]) // no bookings: no ratio, never a divide by zero
  })

  it('ignores rows with an unreadable day and tolerates empty input', () => {
    expect(callActivityTable([{ day: 'x', caller: 'A', calls: '1' }], null, null)).toEqual([])
    expect(callActivityTable(undefined, null, null)).toEqual([])
  })
})

describe('call flags', () => {
  it('show the calendar status and what the phone records show', () => {
    expect(flagValues({ type: 'showed_without_call', old_value: 'showed', new_value: 'no_call' })).toEqual({ was: 'Showed', now: 'No call', official: '' })
    expect(flagValues({ type: 'unmarked_with_call', old_value: '(blank)', new_value: 'long_call' })).toEqual({ was: 'Not marked', now: 'Long call', official: '' })
    expect(flagValues({ type: 'booker_not_owner', old_value: 'Anita Andrews', new_value: 'Hugo Sharpe' })).toEqual({ was: '', now: 'Hugo Sharpe', official: 'Anita Andrews' })
    expect(typeLabel('noshow_with_call')).toMatch(/No-show/)
  })
})
