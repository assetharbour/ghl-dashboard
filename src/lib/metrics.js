import { num, parseDate, parseBool, isBlank, daysBetween } from './format'

// Pipeline stages in actual funnel order — never sort these alphabetically.
//
// GHL added a "Lost" stage after this list was first built, sitting last in
// GHL's own stage order (position 14, after Post Completion) — but it is
// deliberately NOT included here. stageAtOrBeyond()/stageIndex() treat a
// stage's position in this array as "how far the case progressed"; if
// "Lost" were appended at the end, a case lost early (e.g. at Docs
// Requested) would read as having reached every later stage — Offers
// Issued, Completion, all of it — the moment it's moved to Lost. Leaving
// it out of STAGE_ORDER makes stageIndex() return -1 for it, so every
// stageAtOrBeyond() check correctly evaluates to false for a lost case,
// with no special-casing needed. It still displays correctly everywhere
// that just reads pipeline_stage directly (tables, filters, exports) since
// those aren't driven by this array.
export const STAGE_ORDER = [
  'Lead Received',
  'Client Contacted', // was "Admin Contacted" until GHL renamed the stage
  'Appointment Booked',
  'Post Appointment', // new GHL stage: the advisor call was answered, documents not yet requested
  'Interested / Not Ready',
  'Docs Requested',
  'Docs Received / Full Review',
  'Advisor Recommendation',
  // Added by the client after this list was first built — sits here in
  // GHL's own live stage order (confirmed via the pipelines API).
  'Awaiting Client Response',
  'Solicitor / Application Prep',
  'Application Submitted',
  'Lender Processing',
  'Offer Issued',
  'Exchange',
  'Completion',
  'Post Completion',
]

export const CHART_COLORS = ['#6DA544', '#2E3A48', '#94C973', '#5B7B94', '#C7DDB5', '#8896A6']

// The only 4 people GHL's own workflows ever assign as contact owner:
// "WF - S1 Lead Intake" sets Anita Andrews at Stage 1; "WF – S6 Docs
// Received Handler" reassigns to Ben Robertson / Lewis Flude / Alison
// Gulliver based on the admin_handover field (or removes the owner
// entirely on its "None" branch). Any other Admin value was set by a
// human manually reassigning the contact in GHL, bypassing both flows.
// Updated for the S1-S6 workflows (22 Oct 2026): S1 Lead Intake now round-robins new leads to the 3 sales reps
// (Ava, Harry, Hugo), so they are expected owners at stages 1-3, alongside the original four.
export const EXPECTED_ADMINS = ['Anita Andrews', 'Ben Robertson', 'Lewis Flude', 'Alison Gulliver', 'Ava Morris-Boundy', 'Harry Kalsi', 'Hugo Sharpe']

export function isAnomalousAdmin(adminValue) {
  return Boolean(adminValue) && !EXPECTED_ADMINS.includes(adminValue)
}

export const ADMIN_GROUP_HANDOVER = 'Handover Team'
export const ADMIN_GROUP_ANOMALOUS = 'Unexpected / Needs Review'
export const ADMIN_GROUP_ORDER = [ADMIN_GROUP_HANDOVER, ADMIN_GROUP_ANOMALOUS]

export function adminGroup(adminValue) {
  return isAnomalousAdmin(adminValue) ? ADMIN_GROUP_ANOMALOUS : ADMIN_GROUP_HANDOVER
}

// Spread into any DataTable `filters` entry for the "admin" field. The
// dropdown itself only ever offers the 4 valid handover-flow outcomes —
// anomalous admin values (manual GHL reassignments) aren't a business
// state a user should filter FOR, so they're deliberately excluded here.
// This does NOT remove those rows from any table/drilldown/export; the
// Case Management "Needs Review" panel is still where they're surfaced,
// via isAnomalousAdmin directly.
export const ADMIN_FILTER_PROPS = {
  allowedValues: EXPECTED_ADMINS,
}

export function stageIndex(stage) {
  return STAGE_ORDER.indexOf(stage)
}

export function stageAtOrBeyond(row, stageName) {
  const idx = stageIndex(row.pipeline_stage)
  return idx >= 0 && idx >= stageIndex(stageName)
}

export function inCurrentMonth(dateStr) {
  const d = parseDate(dateStr)
  if (!d) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

// The product end date (the date a fixed rate / ERC period ends) is the ERC Date field. Talha confirmed this on 19 Oct
// 2026. The older "mortgage product roll-off date" is the same thing but is filled on only 5 of 123 cases, so it is used
// only when the ERC Date is empty (where both exist they agree: 5 of 5).
export function productEndDate(row) {
  return isBlank(row.erc_date) ? row.mortgage_product_roll_off_date : row.erc_date
}

export function totalCallAttempts(row) {
  return num(row.admin_call_attempt_count) + num(row.advisor_call_attempt_count)
}

export function isMortgageCase(row) {
  return !isBlank(row.mortgage_case_type)
}

export function hasProtection(row) {
  return parseBool(row.has_protection)
}

// On Hold = case_status is 'abandoned' — not pause_automations, which is a
// noisy multi-select of which pipeline stages have automations paused and
// stays populated on cases long after they've closed (won/lost/abandoned),
// so it doesn't reliably mean "currently on hold."
export function isOnHold(row) {
  return row.case_status === 'abandoned'
}

// Proxy for "Awaiting Client Response" — no literal GHL field, tag, or task
// matches this concept. The task's own suggested proxy
// (docs_status=='Partial' AND docs_chase_attempt_count>=1) yields zero live
// matches: docs_status never actually contains 'Partial' in practice (only
// 'Pending'/'Complete' appear) and docs_chase_attempt_count is 0% populated.
// This adjusted, empirically-viable proxy is a best-effort stand-in, not a
// confirmed "awaiting client" status.
export function isAwaitingClientResponse(row) {
  return String(row.docs_status).trim().toLowerCase() === 'pending' && row.case_status === 'open'
}

// Live property_status values are lower-cased-second-word ("Owner
// occupied" / "Buy-to-let"), unlike how the client described them
// ("Owner Occupied" / "Buy-to-Let") — matched case-insensitively here.
// "Both" has never appeared live but is matched in case it starts being used.
export function isFindingPropertyCase(row) {
  const v = String(row.property_status).trim().toLowerCase()
  if (!(v === 'buy-to-let' || v === 'both') || row.case_status !== 'open') return false
  // Once a case has moved forward past Awaiting Client Response, the
  // property is assumed secured even if property_status was never
  // manually flipped back — staff forget to update that field once the
  // client has actually found somewhere. Sitting AT that stage still
  // counts, since forward progress hasn't happened yet.
  const idx = stageIndex(row.pipeline_stage)
  const acrIdx = stageIndex('Awaiting Client Response')
  if (idx >= 0 && acrIdx >= 0 && idx > acrIdx) return false
  return true
}

// case_status = open AND older than 30 days AND still in the first 3 stages.
// Client request (6 Oct 2026): a case at Appointment Booked is only flagged once its appointment date has PASSED
// (it should have moved on by then); a future appointment is not stuck. `__appt_start` (ms) is the start of the contact's
// latest live calendar appointment, added by attachAppointmentStart(); without it the plain age rule applies.
export function isStuck(row, now = new Date()) {
  if (row.case_status !== 'open') return false
  const created = parseDate(row.created_date)
  if (!created) return false
  const ageDays = (now.getTime() - created.getTime()) / 86400000
  const idx = stageIndex(row.pipeline_stage)
  if (!(ageDays > 30 && idx >= 0 && idx < 3)) return false
  if (row.pipeline_stage === 'Appointment Booked' && typeof row.__appt_start === 'number') return row.__appt_start < now.getTime()
  return true
}

// Adds `__appt_start` (ms) to each lead that has a live (not cancelled, not deleted) calendar appointment: the start of the
// contact's most recently BOOKED one. Leads with no calendar appointment are returned untouched.
export function attachAppointmentStart(rows, appointments) {
  const latest = new Map()
  for (const a of appointments || []) {
    if (!a.contact_id || !isBlank(a.deleted) || String(a.status).trim().toLowerCase() === 'cancelled') continue
    const start = Date.parse(a.start_time)
    if (Number.isNaN(start)) continue
    const booked = String(a.booked_at ?? '')
    const best = latest.get(a.contact_id)
    if (!best || booked > best.booked) latest.set(a.contact_id, { booked, start })
  }
  if (!latest.size) return rows
  return rows.map((r) => (latest.has(r.contact_id) ? { ...r, __appt_start: latest.get(r.contact_id).start } : r))
}

// ERC / product end-date renewal forecast (client priority, 6 Oct 2026): mortgages whose product ends from today to the end
// of next calendar year, month by month, optionally for one advisor. next6 = the next six months from today, nextYear = the
// whole of next calendar year, as clickable row lists. Months are calendar months in the viewer's timezone.
export function ercForecast(rows, now = new Date(), advisor = '') {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const last = new Date(now.getFullYear() + 2, 0, 1).getTime() // exclusive: the end of next calendar year
  const sixMonths = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate()).getTime()
  const months = []
  for (let y = now.getFullYear(), m = now.getMonth(); new Date(y, m, 1).getTime() < last; m++) {
    if (m > 11) { m = 0; y++ }
    months.push({ key: `${y}-${String(m + 1).padStart(2, '0')}`, label: new Date(y, m, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), rows: [] })
  }
  const byKey = new Map(months.map((mo) => [mo.key, mo]))
  const next6 = []
  const nextYear = []
  const nextYearNo = now.getFullYear() + 1
  for (const r of rows) {
    if (advisor && String(r.advisor_name ?? '').trim() !== advisor) continue
    const d = parseDate(productEndDate(r))
    if (!d) continue
    const t = d.getTime()
    if (t < start || t >= last) continue
    const row = { ...r, __productEnd: productEndDate(r) }
    byKey.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)?.rows.push(row)
    if (t < sixMonths) next6.push(row)
    if (d.getFullYear() === nextYearNo) nextYear.push(row)
  }
  return { months, next6, nextYear, nextYearNo, total: months.reduce((n, mo) => n + mo.rows.length, 0) }
}

export function countBy(rows, keyFn) {
  const map = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    map.set(k, (map.get(k) || 0) + 1)
  }
  return map
}

export function mean(values) {
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

// Mean of avg_days_to_completion excluding blanks (blank ≠ 0)
export function avgDaysToCompletion(rows) {
  const vals = rows
    .filter((r) => !isBlank(r.avg_days_to_completion) && Number.isFinite(Number(r.avg_days_to_completion)))
    .map((r) => Number(r.avg_days_to_completion))
  return mean(vals)
}

// Advisor Performance's "Avg Days to Completion" — opportunity created_date
// to completion_date, computed per row and averaged (rows missing either
// date are excluded, not counted as 0). Only counts rows that have actually
// reached the "Completion" pipeline stage — a case with both dates set but
// still sitting at an earlier stage (e.g. a pre-filled target date) doesn't
// count as completed yet. Distinct from avgDaysToCompletion above, which
// reads the Sheet's pre-computed avg_days_to_completion column
// (first_contact_time → completion_time) used on the Overview page.
export function avgDaysCreatedToCompletion(rows) {
  const vals = rows
    .filter((r) => r.pipeline_stage === 'Completion')
    .map((r) => {
      const created = parseDate(r.created_date)
      const completion = parseDate(r.completion_date)
      return created && completion ? daysBetween(created, completion) : null
    })
    .filter((v) => v !== null)
  return mean(vals)
}

export const DATE_RANGES = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'week', label: 'This week' },
  { id: 'lastweek', label: 'Last week' },
  { id: 'month', label: 'This month' },
  { id: 'lastmonth', label: 'Last month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'all', label: 'All time' },
]

/**
 * The [from, to) window of a date-range choice, or null for "all time".
 * `to` is null when the window is open-ended (up to now). Weeks start on Monday.
 * The pay and target reports are weekly and monthly, hence the week / month presets.
 */
export function rangeBounds(rangeId, customRange, now = new Date()) {
  if (rangeId === 'all') return null
  if (rangeId === 'custom') {
    if (!customRange?.from || !customRange?.to) return null
    const to = new Date(customRange.to)
    to.setHours(23, 59, 59, 999) // include the whole end day
    return { from: new Date(customRange.from), to, inclusiveTo: true }
  }
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const monday = new Date(day)
  monday.setDate(day.getDate() - ((day.getDay() + 6) % 7))
  switch (rangeId) {
    case 'week':
      return { from: monday, to: null }
    case 'lastweek': {
      const from = new Date(monday)
      from.setDate(monday.getDate() - 7)
      return { from, to: monday }
    }
    case 'month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null }
    case 'lastmonth':
      return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) }
    case 'quarter':
      return { from: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1), to: null }
    default: {
      const days = { '7d': 7, '30d': 30, '90d': 90 }[rangeId]
      return { from: new Date(now.getTime() - days * 86400000), to: null }
    }
  }
}

export function filterByDateRange(rows, rangeId, customRange, now = new Date()) {
  const bounds = rangeBounds(rangeId, customRange, now)
  if (!bounds) return rows
  return rows.filter((r) => {
    const d = parseDate(r.created_date)
    return d && d >= bounds.from && (!bounds.to || (bounds.inclusiveTo ? d <= bounds.to : d < bounds.to))
  })
}
