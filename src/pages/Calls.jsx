import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Info } from 'lucide-react'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import DataTable from '../components/DataTable'
import Skeleton from '../components/Skeleton'
import { fmtInt, fmtPct, fmtDate, num, isBlank, parseDate, daysBetween, DASH } from '../lib/format'
import { CHART_COLORS, ADMIN_FILTER_PROPS } from '../lib/metrics'

const eqi = (v, target) => String(v).trim().toLowerCase() === target
const NO_ADMIN = '(No admin assigned)'
const NO_ADVISOR = '(No advisor assigned)'

// admin_call_status / advisor_call_status are both 4-option GHL dropdowns:
// Answered, No Answer, Voicemail, Pending. Answered/No Answer/Voicemail all
// mean the call actually happened — GHL increments the attempt counter the
// moment a call is logged as one of these. Pending means the opposite: the
// call hasn't happened yet, it's queued waiting for its next attempt time —
// so it must NOT count as "attempted," even though the field itself is
// non-blank. This is the one status value that isn't evidence of a call.
const CONTACTED_STATUSES = ['answered', 'no answer', 'voicemail']

// GHL is supposed to bump the attempt counter to at least 1 the moment a
// call is logged as Answered/No Answer/Voicemail, but it doesn't always
// fire — admin_call_attempt_count is populated on only ~20% of rows while
// admin_call_status is populated on ~69%. Trusting the raw counter alone
// undercounts attempts below the count of completed-outcome leads, which
// is impossible (you can't answer a call without attempting it). This
// enforces the floor: a completed-outcome row always counts as >= 1
// attempt even when the counter field itself is blank/stale.
const effectiveAttempts = (r, attemptField, statusField) => {
  const raw = num(r[attemptField])
  return CONTACTED_STATUSES.includes(String(r[statusField]).trim().toLowerCase()) ? Math.max(raw, 1) : raw
}
const isAttempted = (r, attemptField, statusField) => effectiveAttempts(r, attemptField, statusField) > 0

/** One row per distinct value of groupKeyFn — leads count, total attempts, answered, contact rate. */
function leaderboardRows(rows, { groupKeyFn, statusField, attemptField, defaultLabel }) {
  const groups = new Map()
  for (const r of rows) {
    const key = groupKeyFn(r) || defaultLabel
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  return [...groups.entries()].map(([name, groupRows]) => {
    const attempts = groupRows.reduce((sum, r) => sum + effectiveAttempts(r, attemptField, statusField), 0)
    const answered = groupRows.filter((r) => eqi(r[statusField], 'answered')).length
    const attempted = groupRows.filter((r) => isAttempted(r, attemptField, statusField)).length
    return {
      __key: name,
      name,
      count: groupRows.length,
      attempts,
      answered,
      attempted,
      contactRatePct: attempted ? (100 * answered) / attempted : null,
    }
  })
}

const leaderboardCols = (roleLabel) => [
  { key: 'name', label: roleLabel },
  { key: 'count', label: 'Cases' },
  { key: 'attempts', label: 'Total Call Attempts' },
  { key: 'answered', label: 'Answered' },
  { key: 'contactRatePct', label: 'Contact Rate', render: (r) => fmtPct(r.answered, r.attempted) },
]

// Due when: completion 11+ months ago, OR mortgage_product_roll_off_date is
// within the next 90 days — whichever trigger fires first ("soonest of the
// two candidate due dates") drives the reason shown. Only cases with a
// completion_date set are eligible at all.
function annualReviewCandidates(rows, now = new Date()) {
  return rows
    .filter((r) => !isBlank(r.completion_date))
    .map((r) => {
      const completion = parseDate(r.completion_date)
      if (!completion) return null
      const rollOff = parseDate(r.mortgage_product_roll_off_date)
      const completionDueDate = new Date(
        completion.getFullYear(),
        completion.getMonth() + 11,
        completion.getDate()
      )
      const dueDate = rollOff && rollOff < completionDueDate ? rollOff : completionDueDate
      return { ...r, __daysUntilDue: Math.round(daysBetween(now, dueDate)) }
    })
    .filter((r) => r && r.__daysUntilDue <= 90)
    .sort((a, b) => a.__daysUntilDue - b.__daysUntilDue)
}

function dueLabel(days) {
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'Due today'
  return `in ${days}d`
}

const KNOWN_STATUSES = ['answered', 'no answer', 'voicemail', 'pending']

/** Builds the outcome/histogram/KPI numbers for one call stage (admin or advisor). */
function buildCallStats(rows, { statusField, attemptField }) {
  const totalAttempts = rows.reduce((sum, r) => sum + effectiveAttempts(r, attemptField, statusField), 0)
  const answered = rows.filter((r) => eqi(r[statusField], 'answered'))
  const noAnswer = rows.filter((r) => eqi(r[statusField], 'no answer'))
  const voicemail = rows.filter((r) => eqi(r[statusField], 'voicemail'))
  // Pending means the call hasn't happened yet — it's queued for its next
  // attempt time, not a completed outcome. Kept separate from "attempted".
  const pending = rows.filter((r) => eqi(r[statusField], 'pending'))
  const notCalled = rows.filter((r) => isBlank(r[statusField]))
  const otherStatus = rows.filter(
    (r) => !isBlank(r[statusField]) && !KNOWN_STATUSES.includes(String(r[statusField]).trim().toLowerCase())
  )

  // "Attempted" = the call actually happened: either GHL's attempt counter
  // is > 0, or the status is one of the 3 completed-call outcomes
  // (Answered/No Answer/Voicemail). Pending and blank are both excluded —
  // pending is explicitly "not yet attempted, waiting for next attempt".
  const attempted = rows.filter((r) => isAttempted(r, attemptField, statusField))

  const outcomes = [
    { name: 'Answered', count: answered.length, rows: answered },
    { name: 'No Answer', count: noAnswer.length, rows: noAnswer },
    { name: 'Voicemail', count: voicemail.length, rows: voicemail },
    { name: 'Pending', count: pending.length, rows: pending },
    { name: 'Not called', count: notCalled.length, rows: notCalled },
    ...(otherStatus.length ? [{ name: 'Other', count: otherStatus.length, rows: otherStatus }] : []),
  ]

  const buckets = ['0', '1', '2', '3', '4+'].map((label) => ({ label, rows: [] }))
  for (const r of rows) {
    const n = effectiveAttempts(r, attemptField, statusField)
    const idx = n >= 4 ? 4 : n
    buckets[idx].rows.push(r)
  }
  const histogram = buckets.map((b) => ({ label: b.label, count: b.rows.length, rows: b.rows }))

  return { totalAttempts, answered, noAnswer, voicemail, pending, notCalled, attempted, outcomes, histogram }
}

function CallSection({ title, subtitle, scopeLabel, stats, attemptCols, totalRows }) {
  return (
    <div className="space-y-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {subtitle && <p className="text-xs text-muted -mt-4">{subtitle}</p>}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <KPICard label={`${scopeLabel} Call Attempts`} value={fmtInt(stats.totalAttempts)} />
        <KPICard label="Answered" value={fmtInt(stats.answered.length)} />
        <KPICard label="No Answer" value={fmtInt(stats.noAnswer.length)} />
        <KPICard label="Voicemail" value={fmtInt(stats.voicemail.length)} />
        <KPICard label="Pending" value={fmtInt(stats.pending.length)} sub="waiting for next attempt" />
        <KPICard
          label={`${scopeLabel} Contact Rate`}
          value={fmtPct(stats.answered.length, stats.attempted.length)}
          sub={`${fmtInt(stats.attempted.length)} leads attempted`}
        />
        <KPICard
          label={`Avg ${scopeLabel} Attempts per Lead`}
          value={totalRows ? (stats.totalAttempts / totalRows).toFixed(1) : DASH}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <ChartCard title="Call Outcomes" subtitle={`${title}. Click a bar to view records`}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stats.outcomes} margin={{ top: 8, right: 8 }}>
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#1F2937' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <Tooltip cursor={{ fill: '#F7F9FB' }} formatter={(v) => [fmtInt(v), 'Leads']} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} cursor="pointer" onClick={attemptCols.onOutcomeClick}>
                {stats.outcomes.map((entry, i) => (
                  <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Attempts Distribution" subtitle="number of leads per attempt count">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stats.histogram} margin={{ top: 8, right: 8 }}>
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#1F2937' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <Tooltip cursor={{ fill: '#F7F9FB' }} formatter={(v) => [fmtInt(v), 'Leads']} />
              <Bar
                dataKey="count"
                fill="#6DA544"
                radius={[4, 4, 0, 0]}
                cursor="pointer"
                onClick={attemptCols.onHistogramClick}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}

export default function Calls() {
  const { rows, loading, openDrilldown } = useData()

  const admin = useMemo(
    () => buildCallStats(rows, { statusField: 'admin_call_status', attemptField: 'admin_call_attempt_count' }),
    [rows]
  )
  const advisorStats = useMemo(
    () => buildCallStats(rows, { statusField: 'advisor_call_status', attemptField: 'advisor_call_attempt_count' }),
    [rows]
  )

  const stuck = useMemo(
    () =>
      rows
        .filter((r) => num(r.admin_call_attempt_count) >= 3 && r.case_status === 'open')
        .map((r) => ({ ...r, __attempts: num(r.admin_call_attempt_count) }))
        .sort((a, b) => b.__attempts - a.__attempts),
    [rows]
  )

  const adminLeaderboard = useMemo(
    () =>
      leaderboardRows(rows, {
        groupKeyFn: (r) => r.admin,
        statusField: 'admin_call_status',
        attemptField: 'admin_call_attempt_count',
        defaultLabel: NO_ADMIN,
      }),
    [rows]
  )
  const advisorLeaderboard = useMemo(
    () =>
      leaderboardRows(rows, {
        groupKeyFn: (r) => r.advisor_name,
        statusField: 'advisor_call_status',
        attemptField: 'advisor_call_attempt_count',
        defaultLabel: NO_ADVISOR,
      }),
    [rows]
  )

  const annualReview = useMemo(() => annualReviewCandidates(rows), [rows])
  const annualReviewCols = [
    { key: 'client_name', label: 'Client' },
    { key: 'completion_date', label: 'Completed', render: (r) => fmtDate(r.completion_date) },
    {
      key: 'mortgage_product_roll_off_date',
      label: 'Product Roll-off',
      render: (r) => fmtDate(r.mortgage_product_roll_off_date),
    },
    { key: 'admin', label: 'Admin' },
    {
      key: '__daysUntilDue',
      label: 'Days Until/Since Due',
      render: (r) => dueLabel(r.__daysUntilDue),
      sortValue: (r) => r.__daysUntilDue,
    },
  ]

  const adminAttemptCols = [
    { key: 'admin_call_attempt_count', label: 'Admin Attempts' },
    { key: 'admin_call_status', label: 'Admin Call Status' },
  ]
  const advisorAttemptCols = [
    { key: 'advisor_call_attempt_count', label: 'Advisor Attempts' },
    { key: 'advisor_call_status', label: 'Advisor Call Status' },
  ]

  return (
    <div className="space-y-8">
      <CallSection
        title="Admin Calls (Stage 1)"
        subtitle="First-contact call made by the admin handling the case: admin_call_status / admin_call_attempt_count"
        scopeLabel="Admin"
        stats={admin}
        totalRows={rows.length}
        attemptCols={{
          onOutcomeClick: (d) => openDrilldown(`${d.name} (admin): ${fmtInt(d.count)} leads`, d.rows, adminAttemptCols),
          onHistogramClick: (d) =>
            openDrilldown(`${d.label} admin call attempts: ${fmtInt(d.count)} leads`, d.rows, adminAttemptCols),
        }}
      />

      <div className="border-t border-line" />

      <CallSection
        title="Advisor Calls (Stage 3)"
        subtitle="Advisor's own call at Appointment Booked: advisor_call_status / advisor_call_attempt_count (separate from the Stage 7 recommendation call)"
        scopeLabel="Advisor"
        stats={advisorStats}
        totalRows={rows.length}
        attemptCols={{
          onOutcomeClick: (d) =>
            openDrilldown(`${d.name} (advisor): ${fmtInt(d.count)} leads`, d.rows, advisorAttemptCols),
          onHistogramClick: (d) =>
            openDrilldown(`${d.label} advisor call attempts: ${fmtInt(d.count)} leads`, d.rows, advisorAttemptCols),
        }}
      />

      <div className="border-t border-line" />

      <div className="space-y-5">
        <div>
          <h2 className="text-base font-semibold text-ink">Annual Review Calls – Mortgage &amp; Protection</h2>
          <p className="text-xs text-muted mt-1">
            Completed cases due for a review call: 11+ months since completion_date, or
            mortgage_product_roll_off_date within the next 90 days — whichever comes first
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard
            label="Annual Review Calls Due"
            value={fmtInt(annualReview.length)}
            sub="11mo+ since completion OR roll-off within 90 days"
            alert={annualReview.length > 0}
            onClick={() =>
              openDrilldown(`Annual review calls due: ${fmtInt(annualReview.length)}`, annualReview, annualReviewCols)
            }
          />
        </div>
        {loading ? (
          <Skeleton className="h-80" />
        ) : (
          <div className="card p-5">
            <DataTable
              columns={annualReviewCols}
              rows={annualReview}
              filters={[{ key: 'admin', label: 'Admin', ...ADMIN_FILTER_PROPS }]}
              pageSize={25}
              exportName="annual_review_calls_due"
              initialSort={{ key: '__daysUntilDue', dir: 'asc' }}
            />
          </div>
        )}
      </div>

      <div className="border-t border-line" />

      <div className="space-y-5">
        <div>
          <h2 className="text-base font-semibold text-ink">Calls per User Leaderboard</h2>
          <p className="text-xs text-muted mt-1">
            Total call attempts and contact rate by admin (Stage 1) and by advisor (Stage 3), sorted by volume
          </p>
        </div>
        <div className="grid lg:grid-cols-2 gap-5">
          {loading ? (
            <>
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </>
          ) : (
            <>
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-ink mb-4">By Admin</h3>
                <DataTable
                  columns={leaderboardCols('Admin')}
                  rows={adminLeaderboard}
                  searchable={false}
                  pageSize={25}
                  initialSort={{ key: 'attempts', dir: 'desc' }}
                />
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-ink mb-4">By Advisor</h3>
                <DataTable
                  columns={leaderboardCols('Advisor')}
                  rows={advisorLeaderboard}
                  searchable={false}
                  pageSize={25}
                  initialSort={{ key: 'attempts', dir: 'desc' }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="border-t border-line" />

      {loading ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink mb-1">Stuck in Calling</h3>
          <p className="text-xs text-muted mb-4">
            Open cases with 3+ admin call attempts (Stage 1 only, see note below)
          </p>
          <DataTable
            columns={[
              { key: 'client_name', label: 'Client' },
              {
                key: '__attempts',
                label: 'Admin Attempts',
                render: (r) => fmtInt(r.__attempts),
                sortValue: (r) => r.__attempts,
              },
              {
                key: 'admin_call_status',
                label: 'Last Outcome',
                render: (r) => (isBlank(r.admin_call_status) ? DASH : r.admin_call_status),
              },
              { key: 'lead_source', label: 'Lead Source' },
              { key: 'admin', label: 'Admin' },
            ]}
            rows={stuck}
            filters={[{ key: 'admin', label: 'Admin', ...ADMIN_FILTER_PROPS }]}
            pageSize={25}
            exportName="stuck_in_calling"
            initialSort={{ key: '__attempts', dir: 'desc' }}
          />
        </div>
      )}

      <div className="card px-4 py-3.5 flex items-start gap-2.5 bg-page/60">
        <Info size={15} className="text-muted mt-0.5 shrink-0" />
        <p className="text-[13px] text-muted">
          "Stuck in Calling" and appointment call outcomes are scoped to admin (Stage 1) calls only. Advisor
          call attempts are shown separately above and not yet folded into a stuck-case list. Appointment call
          outcomes will be further enriched when calendar events sync is added.
        </p>
      </div>
    </div>
  )
}
