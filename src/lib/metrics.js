import { num, parseDate, parseBool, isBlank, daysBetween } from './format'

// Pipeline stages in actual funnel order — never sort these alphabetically
export const STAGE_ORDER = [
  'Lead Received',
  'Admin Contacted',
  'Appointment Booked',
  'Interested / Not Ready',
  'Docs Requested',
  'Docs Received / Full Review',
  'Advisor Recommendation',
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
export const EXPECTED_ADMINS = ['Anita Andrews', 'Ben Robertson', 'Lewis Flude', 'Alison Gulliver']

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

export function totalCallAttempts(row) {
  return num(row.admin_call_attempt_count) + num(row.advisor_call_attempt_count)
}

export function isMortgageCase(row) {
  return !isBlank(row.mortgage_case_type)
}

export function hasProtection(row) {
  return parseBool(row.has_protection)
}

export function isOnHold(row) {
  return !isBlank(row.pause_automations)
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
  return (v === 'buy-to-let' || v === 'both') && row.case_status === 'open'
}

// case_status = open AND older than 30 days AND still in the first 3 stages
export function isStuck(row, now = new Date()) {
  if (row.case_status !== 'open') return false
  const created = parseDate(row.created_date)
  if (!created) return false
  const ageDays = (now.getTime() - created.getTime()) / 86400000
  const idx = stageIndex(row.pipeline_stage)
  return ageDays > 30 && idx >= 0 && idx < 3
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

export function conversionRate(rows) {
  if (!rows.length) return null
  return rows.filter((r) => r.case_status === 'won').length / rows.length
}

export const DATE_RANGES = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'all', label: 'All time' },
]

export function filterByDateRange(rows, rangeId) {
  if (rangeId === 'all') return rows
  const now = new Date()
  let from
  if (rangeId === 'quarter') {
    from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
  } else {
    const days = { '7d': 7, '30d': 30, '90d': 90 }[rangeId]
    from = new Date(now.getTime() - days * 86400000)
  }
  return rows.filter((r) => {
    const d = parseDate(r.created_date)
    return d && d >= from
  })
}
