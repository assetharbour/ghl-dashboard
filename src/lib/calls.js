import { namesMatch } from './sales'

// Call evidence and call activity, read from the sync's Call_Evidence and Call_Activity tabs
// (ghl-reporting-sync/app/call_evidence.py). Advisor "meetings" are phone calls made from Evonex at the appointment
// time, so a call by the advisor around the appointment is the proof it took place. The calendar status the team
// marked is NEVER changed by this: the numbers elsewhere stay as marked, and disagreements are shown as flags.

export const RESULT_LABEL = {
  long_call: 'Long call',
  conversation: 'Conversation',
  short_call: 'Short call',
  not_answered: 'Not answered',
  other_caller: 'Someone else called',
  no_call: 'No call',
  no_phone: 'No phone number',
}

// A real conversation took place (the advisor was connected for a minute or more).
export const isConversation = (result) => result === 'long_call' || result === 'conversation'

export function fmtTalk(seconds) {
  const s = Math.round(Number(seconds))
  if (!Number.isFinite(s) || s <= 0) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

/** {appointment_id: evidence row} */
export function evidenceById(evidence) {
  return new Map((evidence || []).map((e) => [e.appointment_id, e]))
}

/** Counts of judged appointments by what the phone records show. `details` are the Sales page's appointment rows. */
export function evidenceSummary(details) {
  const judged = details.filter((d) => d.__evidence)
  const talked = judged.filter((d) => isConversation(d.__evidence.result))
  const noConversation = judged.filter((d) => ['short_call', 'not_answered', 'no_call'].includes(d.__evidence.result))
  return {
    judged,
    talked,
    noConversation,
    noCall: judged.filter((d) => d.__evidence.result === 'no_call'),
    other: judged.filter((d) => ['other_caller', 'no_phone'].includes(d.__evidence.result)),
  }
}

// The Call_Activity "day" is a London calendar date; it is compared to the dashboard's range as that same calendar day.
const dayStart = (day) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''))
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

/**
 * One row per caller for the days inside [start, end) (either may be null). Callers on the sales team also get the
 * appointments they booked in the same range and the calls made per appointment booked (scope 1.11).
 * bookedByPerson: {name: booked count} for the same range.
 */
export function callActivityTable(activity, start, end, { salesTeam = [], bookedByPerson = {} } = {}) {
  const byCaller = new Map()
  for (const r of activity || []) {
    const d = dayStart(r.day)
    if (!d || (start && d < start) || (end && d >= end)) continue
    const e = byCaller.get(r.caller) ?? { caller: r.caller, calls: 0, connected: 0, conversations: 0, longCalls: 0, noAnswer: 0, talkSeconds: 0 }
    e.calls += Number(r.calls) || 0
    e.connected += Number(r.connected) || 0
    e.conversations += Number(r.conversations) || 0
    e.longCalls += Number(r.long_calls) || 0
    e.noAnswer += Number(r.no_answer) || 0
    e.talkSeconds += Number(r.talk_seconds) || 0
    byCaller.set(r.caller, e)
  }
  const bookedFor = (name) => Object.entries(bookedByPerson).reduce((n, [person, count]) => (namesMatch(person, name) ? n + count : n), 0)
  return [...byCaller.values()]
    .map((e) => {
      const onTeam = salesTeam.some((n) => namesMatch(n, e.caller))
      const booked = onTeam ? bookedFor(e.caller) : null
      return {
        ...e,
        onTeam,
        booked,
        callsPerBooking: onTeam && booked ? e.calls / booked : null,
        answerRate: e.calls ? e.connected / e.calls : null,
      }
    })
    .sort((a, b) => b.calls - a.calls || a.caller.localeCompare(b.caller))
}
