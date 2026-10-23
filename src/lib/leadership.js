import { isBlank, parseDate } from './format'
import { ADVISORS, SALES_TEAM, UNKNOWN, buildSalesTable, bookedInPeriod, namesMatch, weekStart } from './sales'
import { avgDaysCreatedToCompletion, stageAtOrBeyond, isStuck, isAwaitingClientResponse } from './metrics'
import { callActivityTable } from './calls'

// The leadership board: who is performing, in three teams, plus the shape of the pipeline. Every number reuses the definitions
// already used on the other pages so the board can never disagree with them:
//   * completion      = the lead is at the "Completion" stage (same as Overview, Advisor Performance, Introducers)
//   * completions in a period are counted when they COMPLETED (completion date inside the range; with "All time" every one),
//     not by when the lead was created, so a case that completes this month counts this month whatever its age
//   * appointments    = the S3 calendar, booked in the date range (same as the Sales Team page)
//   * lead cohort     = leads CREATED in the date range (leads received, introducers, the funnel)
// Small samples are never ranked as if they were meaningful: a speed figure needs MIN_LEADS_FOR_SPEED leads behind it.

export const HANDOVER_ADMINS = ['Anita Andrews', 'Ben Robertson', 'Lewis Flude', 'Alison Gulliver']
export const MIN_LEADS_FOR_SPEED = 3
export const SPEED_BUCKETS = [
  { id: 'b5', label: 'Within 5 min', max: 5 },
  { id: 'b15', label: '5 to 15 min', max: 15 },
  { id: 'b60', label: '15 to 60 min', max: 60 },
  { id: 'b240', label: '1 to 4 hours', max: 240 },
  { id: 'late', label: 'Over 4 hours', max: Infinity },
]

const ratio = (a, b) => (b ? a / b : null)
const sumBy = (rows, fn) => rows.reduce((t, r) => t + fn(r), 0)
const revenueOf = (r) => (isBlank(r.total_revenue) || !Number.isFinite(Number(r.total_revenue)) ? 0 : Number(r.total_revenue))
const isCompletion = (r) => r.pipeline_stage === 'Completion'

/** A completed lead whose completion date is inside [start, end) (no range = every completed lead). */
export function completedInRange(r, start = null, end = null) {
  if (!isCompletion(r)) return false
  if (!start && !end) return true
  const t = parseDate(r.completion_date)?.getTime()
  return t !== undefined && !Number.isNaN(t) && (!start || t >= start.getTime()) && (!end || t < end.getTime())
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** Sort by a metric (largest first, blanks last), ties by the second metric then name, and number the places. */
export function rank(rows, primary, secondary = () => 0) {
  const val = (r, fn) => {
    const x = fn(r)
    return x === null || x === undefined || Number.isNaN(x) ? -Infinity : x
  }
  const sorted = [...rows].sort((a, b) => val(b, primary) - val(a, primary) || val(b, secondary) - val(a, secondary) || String(a.name).localeCompare(String(b.name)))
  let place = 0
  let previous
  return sorted.map((r, i) => {
    const key = `${val(r, primary)}|${val(r, secondary)}`
    if (key !== previous) place = i + 1
    previous = key
    return { ...r, place }
  })
}

// ------------------------------------------------------------------------------------------------------ speed to lead

const minutesOf = (r, field) => (isBlank(r[field]) ? null : Number(r[field]))

/**
 * Speed to lead for leads created in [start, end). `speedRows` is the Lead_Speed tab. Leads still inside their first hour
 * ("waiting") and leads with no phone number are left out; leads nobody has called count as not called.
 */
export function speedSummary(speedRows, start = null, end = null, salesTeam = SALES_TEAM) {
  const inRange = (speedRows || []).filter((r) => {
    const t = parseDate(r.created_at)?.getTime()
    return t !== undefined && !Number.isNaN(t) && (!start || t >= start.getTime()) && (!end || t < end.getTime())
  })
  const judged = inRange.filter((r) => r.status === 'called' || r.status === 'not_called')
  const called = judged.filter((r) => r.status === 'called')
  const minutes = called.map((r) => minutesOf(r, 'minutes_to_first_call')).filter((m) => m !== null)
  const connectMinutes = called.map((r) => minutesOf(r, 'minutes_to_first_connect')).filter((m) => m !== null)

  const buckets = SPEED_BUCKETS.map((b, i) => {
    const low = i ? SPEED_BUCKETS[i - 1].max : -Infinity
    return { ...b, count: minutes.filter((m) => m > low && m <= b.max).length }
  })
  const withinFifteen = minutes.filter((m) => m <= 15).length

  const callers = new Map()
  for (const r of called) {
    const name = r.first_call_by || UNKNOWN
    if (!callers.has(name)) callers.set(name, [])
    callers.get(name).push(minutesOf(r, 'minutes_to_first_call'))
  }
  const byCaller = [...callers.entries()]
    .map(([name, list]) => ({
      name,
      leads: list.length,
      median: median(list),
      withinFifteen: list.filter((m) => m <= 15).length,
      onSalesTeam: salesTeam.some((n) => namesMatch(n, name)),
      enough: list.length >= MIN_LEADS_FOR_SPEED,
    }))
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name))

  return {
    leads: judged.length,
    called: called.length,
    notCalled: judged.length - called.length,
    waiting: inRange.filter((r) => r.status === 'waiting').length,
    noPhone: inRange.filter((r) => r.status === 'no_phone').length,
    median: median(minutes),
    medianConnect: median(connectMinutes),
    withinFifteen,
    pctWithinFifteen: ratio(withinFifteen, judged.length),
    buckets,
    byCaller,
    rows: judged,
  }
}

export function fmtMinutes(m) {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—'
  if (m < 1) return '<1 min'
  if (m < 60) return `${Math.round(m)} min`
  if (m < 60 * 24) return `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`
  return `${(m / 1440).toFixed(1)} days`
}

// ---------------------------------------------------------------------------------------------------------- the boards

/** Sales team: appointments they booked, how those turned out, and how hard they work the phone. */
export function salesBoard({ appointments, contacts, now, start, end, callActivity, speed, salesTeam = SALES_TEAM }) {
  const table = buildSalesTable(appointments, contacts, now, { start, end, group: 'booker', salesTeam })
  const calls = callActivityTable(callActivity, start, end, { salesTeam })
  const rows = salesTeam.map((name) => {
    const t = table.find((r) => namesMatch(r.person, name))
    const c = calls.find((r) => namesMatch(r.caller, name))
    const s = speed.byCaller.find((r) => namesMatch(r.name, name))
    const booked = t?.booked ?? 0
    return {
      name,
      booked,
      showed: t?.showed ?? 0,
      due: t?.due ?? 0,
      showRate: t?.showRate ?? null,
      noShow: t?.noShow ?? 0,
      fullFactFinds: t?.fullFactFinds ?? 0,
      completed: t?.completed ?? 0,
      conversion: t?.conversion ?? null,
      calls: c?.calls ?? 0,
      conversations: c?.conversations ?? 0,
      talkSeconds: c?.talkSeconds ?? 0,
      callsPerBooking: booked && c ? c.calls / booked : null,
      speedMedian: s?.enough ? s.median : null,
      speedLeads: s?.leads ?? 0,
    }
  })
  return rank(rows, (r) => r.booked, (r) => r.showed)
}

/**
 * Advisors: the leads assigned to them in the period (advisor-name field), the appointments they held (S3 calendar), and the cases they
 * COMPLETED in the period with the fees recorded on those cases. Ranked by completions.
 */
export function advisorBoard({ rows, allRows, appointments, contacts, now, start, end, advisorNames = ADVISORS }) {
  const table = buildSalesTable(appointments, contacts, now, { start, end, group: 'advisor' })
  const board = advisorNames.map((name) => {
    const mine = rows.filter((r) => namesMatch(r.advisor_name, name))
    const completions = allRows.filter((r) => namesMatch(r.advisor_name, name) && completedInRange(r, start, end))
    const t = table.find((r) => namesMatch(r.person, name))
    return {
      name,
      assigned: mine.length,
      completions: completions.length,
      revenue: sumBy(completions, revenueOf),
      avgDays: avgDaysCreatedToCompletion(completions),
      appointments: t?.booked ?? 0,
      showed: t?.showed ?? 0,
      showRate: t?.showRate ?? null,
      fullFactFinds: t?.fullFactFinds ?? 0,
      stuck: mine.filter((r) => isStuck(r, now)).length,
    }
  })
  return rank(board.filter((b) => b.assigned || b.appointments || b.completions), (r) => r.completions, (r) => r.assigned)
}

/**
 * The handover team (once a case leaves the sales team): the open cases each person holds right now (a snapshot, not tied to the date
 * range), and what they COMPLETED in the period. Ranked by completions, then by cases that have reached an application.
 */
export function adminBoard({ allRows, now, start = null, end = null, admins = HANDOVER_ADMINS }) {
  const board = admins.map((name) => {
    const mine = allRows.filter((r) => namesMatch(r.admin, name))
    const open = mine.filter((r) => r.case_status === 'open')
    const completions = mine.filter((r) => completedInRange(r, start, end))
    return {
      name,
      open: open.length,
      progressed: open.filter((r) => stageAtOrBeyond(r, 'Application Submitted')).length,
      completions: completions.length,
      avgDays: avgDaysCreatedToCompletion(completions),
      stuck: open.filter((r) => isStuck(r, now)).length,
      awaitingClient: open.filter(isAwaitingClientResponse).length,
      revenue: sumBy(completions, revenueOf),
    }
  })
  return rank(board.filter((b) => b.open || b.completions), (r) => r.completions, (r) => r.progressed)
}

/** Introducers (lead sources) ranked by recorded revenue, then completions, then leads. */
export function introducerBoard(rows, limit = 5) {
  const bySource = new Map()
  for (const r of rows) {
    const source = String(r.lead_source ?? '').trim()
    if (!source) continue
    if (!bySource.has(source)) bySource.set(source, [])
    bySource.get(source).push(r)
  }
  const board = [...bySource.entries()].map(([name, leads]) => {
    const completions = leads.filter(isCompletion).length
    return { name, leads: leads.length, completions, conversion: ratio(completions, leads.length), revenue: sumBy(leads, revenueOf) }
  })
  return rank(board, (r) => r.revenue, (r) => r.completions).slice(0, limit)
}

// -------------------------------------------------------------------------------------------------- pipeline and trend

export const FUNNEL_STAGES = [
  { stage: 'Lead Received', label: 'Leads received' },
  { stage: 'Appointment Booked', label: 'Appointment booked' },
  { stage: 'Docs Requested', label: 'Documents requested' },
  { stage: 'Application Submitted', label: 'Application submitted' },
  { stage: 'Offer Issued', label: 'Offer issued' },
  { stage: 'Completion', label: 'Completed' },
]

/** How many of the leads reached each stage (a lead that went further than a stage counts at it; lost leads never count as progressed). */
export function funnel(rows) {
  const total = rows.length
  return FUNNEL_STAGES.map(({ stage, label }, i) => {
    // The last step uses the same definition as every Completions figure (the Completion stage itself), so the chart agrees with the cards.
    const count = i === 0 ? total : stage === 'Completion' ? rows.filter(isCompletion).length : rows.filter((r) => stageAtOrBeyond(r, stage)).length
    return { stage, label, count, pctOfLeads: ratio(count, total) }
  })
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The last `weeks` Monday-start weeks: leads created, appointments booked and completions (by completion date). */
export function weeklyTrend({ allRows, appointments, now, weeks = 12 }) {
  const thisWeek = weekStart(now)
  const list = []
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(thisWeek)
    d.setDate(thisWeek.getDate() - 7 * i)
    list.push({ key: dayKey(d), label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), leads: 0, appointments: 0, completions: 0 })
  }
  const byKey = new Map(list.map((w) => [w.key, w]))
  const bump = (value, field) => {
    const d = parseDate(value)
    const w = d && byKey.get(dayKey(weekStart(d)))
    if (w) w[field] += 1
  }
  for (const r of allRows) {
    bump(r.created_date, 'leads')
    if (isCompletion(r)) bump(r.completion_date, 'completions')
  }
  for (const a of appointments) if (bookedInPeriod(a, null, null)) bump(a.booked_at, 'appointments')
  return list
}

// ------------------------------------------------------------------------------------------------- headline and honours

/** The headline numbers for the leads created in the range and the appointments booked in it. */
export function headline({ rows, allRows, appointments, contacts, now, start, end, speed }) {
  const total = buildSalesTable(appointments, contacts, now, { start, end, group: 'booker' })
  const booked = sumBy(total, (r) => r.booked)
  const showed = sumBy(total, (r) => r.showed)
  const due = sumBy(total, (r) => r.due)
  const fullFactFinds = sumBy(total, (r) => r.fullFactFinds)
  const completions = allRows.filter((r) => completedInRange(r, start, end))
  return {
    leads: rows.length,
    booked,
    showRate: ratio(showed, due),
    fullFactFinds,
    completions: completions.length,
    revenue: sumBy(rows, revenueOf),
    revenueRecorded: rows.filter((r) => !isBlank(r.total_revenue)).length,
    speedMedian: speed.median,
    speedLeads: speed.leads,
    avgDays: avgDaysCreatedToCompletion(completions),
  }
}

/** One name per honour, or null when nobody has earned it yet (no zero-value "winners"). */
export function honours({ sales, advisors, admins, introducers, speed }) {
  const leader = (list, value) => {
    const top = list[0]
    return top && value(top) > 0 ? top : null
  }
  const topSales = leader(sales, (r) => r.booked)
  const topAdvisor = leader(advisors, (r) => r.completions)
  const topAdmin = leader(admins, (r) => r.completions)
  const topIntroducer = leader(introducers, (r) => r.revenue)
  const quick = speed.byCaller.filter((c) => c.enough && c.median !== null).sort((a, b) => a.median - b.median || a.name.localeCompare(b.name))[0] || null
  return {
    booker: topSales && { name: topSales.name, value: topSales.booked },
    responder: quick && { name: quick.name, value: quick.median, leads: quick.leads },
    advisor: topAdvisor && { name: topAdvisor.name, value: topAdvisor.completions },
    admin: topAdmin && { name: topAdmin.name, value: topAdmin.completions },
    introducer: topIntroducer && { name: topIntroducer.name, value: topIntroducer.revenue },
  }
}
