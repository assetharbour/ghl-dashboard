// Development-only synthetic data for previewing the Sales Team and Flags pages (open the dev server with ?mock).
// Never imported by production code: see the DEV guard in sheets.js. The numbers are invented.

const DAY = 86400000
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

function rng(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const BOOKERS = [['Hugo Sharpe', 0.34], ['Ava Morris-Boundy', 0.34], ['Harry Kalsi', 0.22], ['Sarah Bennett', 0.07], ['Alison Gulliver', 0.03]]
const ADVISORS = [['Joe Nicholls', 0.42], ['Xavier Collin', 0.25], ['Cecilia Szabo', 0.22], ['Henny Lessey', 0.1], ['Anita Andrews', 0.01]]
const OUTCOMES = ['Full Fact Find Took Place - YES', 'Full Fact Find Took Place - YES', 'Full Fact Find Took Place - YES', 'Advice Given - YES', 'Review - YES', '']

function pick(rand, weighted) {
  let r = rand()
  for (const [name, w] of weighted) {
    r -= w
    if (r <= 0) return name
  }
  return weighted[0][0]
}

// variant: '' (normal), 'empty' (audit not run yet), 'evil' (hostile text in names), 'big' (5,000 appointments)
export function mockPayload(variant = '', now = Date.now()) {
  const rand = rng(7)
  const leadsHeader = [
    'contact_id', 'opportunity_id', 'client_name', 'pipeline_stage', 'case_status', 'lead_source', 'admin', 'advisor_name',
    'created_date', 'completion_date', 'fact_find_outcome', 'fact_find_date', 'docs_requested',
  ]
  const leads = [leadsHeader]
  const apptHeader = [
    'appointment_id', 'contact_id', 'calendar_id', 'booked_by_user_id', 'booked_by', 'booked_source', 'booked_at', 'start_time', 'end_time',
    'advisor_user_id', 'advisor', 'status', 'status_updated_at', 'deleted', 'booked_by_official', 'booked_by_basis',
  ]
  const appts = [apptHeader]
  const flags = [['flag_id', 'detected_at', 'type', 'contact_id', 'field', 'old_value', 'new_value', 'locked_value', 'appointment_id', 'detail', 'status']]
  const locks = [['contact_id', 'field', 'first_value', 'first_seen_at', 'current_value']]

  const first = ['Alex', 'Sam', 'Jo', 'Chris', 'Pat', 'Robin', 'Lee', 'Max', 'Kim', 'Dana', 'Tony', 'Sue']
  const last = ['Smith', 'Jones', 'Taylor', 'Brown', 'Wilson', 'Evans', 'Thomas', 'Roberts', 'Walker', 'Wright']
  const sources = ['Website', 'Veriform', 'Choose Leads', 'Homes Estate Agents', 'Existing Client']

  const count = variant === 'big' ? 5000 : 150
  for (let i = 0; i < count; i++) {
    const cid = `c${i}`
    const booker = pick(rand, BOOKERS)
    const advisor = pick(rand, ADVISORS)
    const bookedMs = now - Math.floor(rand() * 70 * DAY)
    const startMs = bookedMs + Math.floor(1 + rand() * 9) * DAY + 9 * 3600000
    const future = startMs > now
    const roll = rand()
    const status = future ? 'confirmed' : roll < 0.62 ? 'showed' : roll < 0.78 ? 'noshow' : roll < 0.9 ? 'cancelled' : 'showed'
    const form = rand() < 0.1
    const outcome = status === 'showed' ? OUTCOMES[Math.floor(rand() * OUTCOMES.length)] : ''
    const completed = outcome.startsWith('Full') && rand() < 0.22 && startMs + 20 * DAY < now
    leads.push([
      cid, `o${i}`, variant === 'evil' && i < 3 ? ['=HYPERLINK("http://evil.example","click")', '+cmd|" /C calc"!A0', '@SUM(1+1)'][i] : `${first[i % first.length]} ${last[(i * 7) % last.length]}`, completed ? 'Completion' : 'Docs Requested', 'open', sources[i % sources.length],
      'Anita Andrews', advisor, iso(bookedMs - 2 * DAY).slice(0, 10), completed ? iso(startMs + 20 * DAY).slice(0, 10) : '', outcome, '', '',
    ])
    appts.push([
      `e${i}`, cid, 'cal', form ? '' : `u-${booker}`, form ? '' : booker, form ? 'booking_widget' : 'contactdetails_page', iso(bookedMs), iso(startMs), iso(startMs + 1800000),
      `u-${advisor}`, advisor, status, iso(bookedMs), '', booker, form ? 'field' : 'calendar',
    ])
    if (rand() < 0.8) locks.push([cid, 'created_by', rand() < 0.5 ? 'Ava Morris-Boundy' : rand() < 0.5 ? 'Hugo Sharpe' : 'Harry Kalsi', iso(bookedMs - 2 * DAY), ''])
  }
  // a few cancelled / no-show clients who were given a new slot
  for (let i = 0; i < 12; i++) {
    const src = appts[1 + i * 3]
    const bookedMs = Date.parse(src[6]) + 5 * DAY
    if (bookedMs > now) continue
    appts.push([`r${i}`, src[1], 'cal', src[3], src[4], src[5], iso(bookedMs), iso(bookedMs + 3 * DAY), iso(bookedMs + 3 * DAY + 1800000), src[9], src[10], 'showed', iso(bookedMs), '', src[14], src[15]])
  }
  const sample = (cid, type, field, was, now2, locked, aid, detail, hoursAgo) =>
    flags.push([`f${flags.length}`, iso(now - hoursAgo * 3600000), type, cid, field, was, now2, locked, aid, detail, 'open'])
  sample('c3', 'created_by_changed', 'created_by', 'Ava Morris-Boundy', 'Hugo Sharpe', 'Ava Morris-Boundy', '', 'changed after being set; reports keep the locked value', 5)
  sample('c9', 'booked_by_missing', 'booked_by', '', 'Harry Kalsi', 'Harry Kalsi', 'e9', 'booked in GHL but the Booked By field was never filled in (the calendar booker is used)', 30)
  sample('c14', 'booked_by_mismatch', 'booked_by', 'Harry Kalsi', 'Hugo Sharpe', 'Hugo Sharpe', 'e14', 'the Booked By field differs from the person the calendar says booked it', 52)
  sample('c20', 'appointment_with_non_advisor', 'advisor', '', 'Anita Andrews', '', 'e20', 'this appointment was booked with someone who is not a listed advisor', 70)
  sample('', 'booking_source_not_trusted', 'booked_source', '', 'booking_widget', '', '', 'appointments from this source use the Booked By field as the official booker', 90)

  if (variant === 'empty') {
    appts.length = 1
    flags.length = 1
    locks.length = 1
  }
  return {
    leadsValues: leads,
    logValues: [['timestamp', 'records_processed', 'status', 'error_message'], [iso(now - 600000), '150', 'success', '']],
    appointmentsValues: appts,
    flagsValues: flags,
    locksValues: locks,
  }
}
