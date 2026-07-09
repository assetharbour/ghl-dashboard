import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Info } from 'lucide-react'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import DataTable from '../components/DataTable'
import Skeleton from '../components/Skeleton'
import { fmtInt, fmtPct, num, isBlank, DASH } from '../lib/format'
import { CHART_COLORS, ADMIN_FILTER_PROPS } from '../lib/metrics'

const eqi = (v, target) => String(v).trim().toLowerCase() === target

/** Builds the outcome/histogram/KPI numbers for one call stage (admin or advisor). */
function buildCallStats(rows, { statusField, attemptField, includePending }) {
  const totalAttempts = rows.reduce((sum, r) => sum + num(r[attemptField]), 0)
  const answered = rows.filter((r) => eqi(r[statusField], 'answered'))
  const noAnswer = rows.filter((r) => eqi(r[statusField], 'no answer'))
  const pending = includePending ? rows.filter((r) => eqi(r[statusField], 'pending')) : []
  const notCalled = rows.filter((r) => isBlank(r[statusField]))
  const knownStatuses = ['answered', 'no answer', ...(includePending ? ['pending'] : [])]
  const otherStatus = rows.filter(
    (r) => !isBlank(r[statusField]) && !knownStatuses.includes(String(r[statusField]).trim().toLowerCase())
  )

  // a lead counts as "attempted" if it has either an attempt count or a recorded outcome —
  // GHL's attempt counters are sparsely populated relative to the status field
  const attempted = rows.filter((r) => num(r[attemptField]) > 0 || !isBlank(r[statusField]))

  const outcomes = [
    { name: 'Answered', count: answered.length, rows: answered },
    { name: 'No Answer', count: noAnswer.length, rows: noAnswer },
    ...(includePending ? [{ name: 'Pending', count: pending.length, rows: pending }] : []),
    { name: 'Not called', count: notCalled.length, rows: notCalled },
    ...(otherStatus.length ? [{ name: 'Other', count: otherStatus.length, rows: otherStatus }] : []),
  ]

  const buckets = ['0', '1', '2', '3', '4+'].map((label) => ({ label, rows: [] }))
  for (const r of rows) {
    const n = num(r[attemptField])
    const idx = n >= 4 ? 4 : n
    buckets[idx].rows.push(r)
  }
  const histogram = buckets.map((b) => ({ label: b.label, count: b.rows.length, rows: b.rows }))

  return { totalAttempts, answered, noAnswer, pending, notCalled, attempted, outcomes, histogram }
}

function CallSection({ title, subtitle, scopeLabel, stats, attemptCols, totalRows, hasPending }) {
  const kpiGridCols = hasPending ? 'xl:grid-cols-6' : 'xl:grid-cols-5'
  return (
    <div className="space-y-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {subtitle && <p className="text-xs text-muted -mt-4">{subtitle}</p>}

      <div className={`grid grid-cols-2 md:grid-cols-3 ${kpiGridCols} gap-4`}>
        <KPICard label={`${scopeLabel} Call Attempts`} value={fmtInt(stats.totalAttempts)} />
        <KPICard label="Answered" value={fmtInt(stats.answered.length)} />
        <KPICard label="No Answer" value={fmtInt(stats.noAnswer.length)} />
        {hasPending && <KPICard label="Pending" value={fmtInt(stats.pending.length)} />}
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
    () => buildCallStats(rows, { statusField: 'admin_call_status', attemptField: 'admin_call_attempt_count', includePending: false }),
    [rows]
  )
  const advisorStats = useMemo(
    () => buildCallStats(rows, { statusField: 'advisor_call_status', attemptField: 'advisor_call_attempt_count', includePending: true }),
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
        hasPending={false}
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
        hasPending
        stats={advisorStats}
        totalRows={rows.length}
        attemptCols={{
          onOutcomeClick: (d) =>
            openDrilldown(`${d.name} (advisor): ${fmtInt(d.count)} leads`, d.rows, advisorAttemptCols),
          onHistogramClick: (d) =>
            openDrilldown(`${d.label} advisor call attempts: ${fmtInt(d.count)} leads`, d.rows, advisorAttemptCols),
        }}
      />

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
