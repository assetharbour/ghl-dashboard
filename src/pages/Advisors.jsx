import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, LabelList } from 'recharts'
import { AlertTriangle } from 'lucide-react'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import Skeleton from '../components/Skeleton'
import { fmtInt, fmtPct, fmtDays, fmtDate, isBlank, parseDate as pd, DASH } from '../lib/format'
import { stageAtOrBeyond, avgDaysCreatedToCompletion, isOnHold, isStuck, mean } from '../lib/metrics'

const eq = (v, target) => String(v).trim().toLowerCase() === target
const NO_ADVISOR = '(No advisor assigned)'
const advisorOf = (r) => {
  const v = String(r.advisor_name || '').trim()
  return v || NO_ADVISOR
}

const METRIC_DEFS = [
  { id: 'assigned', label: 'Cases Assigned', test: () => true },
  { id: 'contacted', label: 'Contacted', test: (r) => eq(r.admin_call_status, 'answered') },
  // advisor_call_status is the advisor's own call outcome at the
  // Appointment Booked stage — "Appointments Booked" = a call was logged
  // at all (status non-blank); "Appointment Completed" = that call was
  // answered. Replaces the old pipeline_stage-progression proxy now that
  // an actual advisor-level signal is available.
  { id: 'appts', label: 'Appointments Booked', test: (r) => !isBlank(r.advisor_call_status) },
  { id: 'appointmentCompleted', label: 'Appointment Completed', test: (r) => eq(r.advisor_call_status, 'answered') },
  { id: 'recommendation', label: 'To Recommendation', test: (r) => stageAtOrBeyond(r, 'Advisor Recommendation') },
  { id: 'apps', label: 'Applications', test: (r) => eq(r.application_submission_status, 'submitted') },
  { id: 'offers', label: 'Offers Issued', test: (r) => stageAtOrBeyond(r, 'Offer Issued') },
  // "Completion" pipeline stage, not the completion_status custom field —
  // matches the top-level Completions/Conversion Rate cards below.
  { id: 'mortgageDone', label: 'Mortgage Completed', test: (r) => r.pipeline_stage === 'Completion' },
  { id: 'protectionDone', label: 'Protection Completed', test: (r) => eq(r.protection_status, 'submitted') },
  { id: 'lost', label: 'Declined / NPW', test: (r) => r.case_status === 'lost' },
  // "On Hold" = case_status === 'abandoned' (see isOnHold in metrics.js).
  // Not a quarter-end snapshot — GHL custom fields hold only current state,
  // there is no historical log of past case_status changes, so a true
  // "on hold at quarter end" figure isn't reconstructable from this data.
  { id: 'onHold', label: 'On Hold (current)', test: (r) => isOnHold(r) },
  // Same isStuck() definition used on Case Management: open, created 30+
  // days ago, and still stuck at one of the first 3 pipeline stages
  // (Lead Received / Admin Contacted / Appointment Booked) — never moved.
  { id: 'stuck', label: 'Stuck / Flagged', test: (r) => isStuck(r) },
]

function clawBackRisk(rows) {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 24)
  return rows.filter((r) => {
    const start = pd(r.protection_start_date)
    return (
      start &&
      start >= cutoff &&
      eq(r.protection_status, 'submitted') &&
      !isBlank(r.protection_policy_number)
    )
  })
}

export default function Advisors() {
  const { rows, loading, openDrilldown } = useData()
  const [advisor, setAdvisor] = useState('all')
  const [sort, setSort] = useState({ key: 'assigned', dir: 'desc' })

  const m = useMemo(() => {
    // This is an advisor performance report — only cases with a named
    // advisor belong in the filter, grid, and KPIs. Unassigned cases are
    // surfaced separately via the "No Advisor Assigned" KPI card instead of
    // being blended into "All Advisors" or given their own grid row.
    const assignedRows = rows.filter((r) => !isBlank(r.advisor_name))
    const unassignedRows = rows.filter((r) => isBlank(r.advisor_name))

    const advisors = [...new Set(assignedRows.map(advisorOf))].sort()
    const selectedRows = advisor === 'all' ? assignedRows : assignedRows.filter((r) => advisorOf(r) === advisor)

    // Measured against the full dataset (not assignedRows) so this still
    // reflects true data-hygiene, independent of the assigned-only scope
    // used everywhere else on this page.
    const populated = assignedRows.length

    const grid = advisors.map((name) => {
      const own = assignedRows.filter((r) => advisorOf(r) === name)
      const counts = {}
      for (const def of METRIC_DEFS) counts[def.id] = own.filter(def.test)
      const won = own.filter((r) => r.case_status === 'won').length
      const lostCount = own.filter((r) => r.case_status === 'lost').length
      // Conversion Rate = reached the "Completion" pipeline stage / all
      // cases assigned — not case_status, which can be marked "won"
      // without the case ever reaching Completion (see Mortgage Completed).
      const completions = own.filter((r) => r.pipeline_stage === 'Completion').length
      // Close rate = completions / (completions + lost) — "won" here means
      // actually reached Completion, same signal as Conversion Rate above,
      // not the raw case_status flag (which can say "won" prematurely).
      // Lost cases never reach Completion by definition, so case_status is
      // still the right source for the lost side.
      const closeRateDenom = completions + lostCount
      const docsChaseVals = own
        .filter((r) => !isBlank(r.docs_chase_attempt_count) && Number.isFinite(Number(r.docs_chase_attempt_count)))
        .map((r) => Number(r.docs_chase_attempt_count))
      return {
        name,
        own,
        counts,
        won,
        completions,
        conv: own.length ? completions / own.length : null,
        closeRateDenom,
        avgDays: avgDaysCreatedToCompletion(own),
        avgDocsChaseAttempts: mean(docsChaseVals),
        openCount: own.filter((r) => r.case_status === 'open').length,
        lostCount,
      }
    })

    const sorted = [...grid].sort((a, b) => {
      const val = (g) => {
        if (sort.key === 'name') return g.name
        if (sort.key === 'conv') return g.conv ?? -1
        if (sort.key === 'closeRate') return g.closeRateDenom ? g.completions / g.closeRateDenom : -1
        if (sort.key === 'avgDays') return g.avgDays ?? Infinity
        if (sort.key === 'avgDocsChaseAttempts') return g.avgDocsChaseAttempts ?? -1
        return g.counts[sort.key]?.length ?? 0
      }
      const av = val(a)
      const bv = val(b)
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sort.dir === 'asc' ? cmp : -cmp
    })

    const clawBack = clawBackRisk(selectedRows)
    return { advisors, selectedRows, grid: sorted, clawBack, populated, baseCount: rows.length, unassignedRows }
  }, [rows, advisor, sort])

  const kpi = useMemo(() => {
    const sel = m.selectedRows
    const won = sel.filter((r) => r.case_status === 'won').length
    const lost = sel.filter((r) => r.case_status === 'lost').length
    // advisor_call_status is the advisor's own call outcome at the
    // Appointment Booked stage. "Appointments Booked" = a call was logged
    // at all; "Appointment Completed" = answered; "No Answer Rate" = no
    // answer as a share of all logged advisor calls (appts, below).
    const appts = sel.filter((r) => !isBlank(r.advisor_call_status))
    const noAnswer = sel.filter((r) => eq(r.advisor_call_status, 'no answer'))
    // Completions/Conversion Rate = reached the "Completion" pipeline
    // stage — not case_status, which can be marked "won" without the case
    // ever reaching Completion (no offer/exchange/completion data set).
    const completions = sel.filter((r) => r.pipeline_stage === 'Completion')
    return {
      assigned: sel,
      contacted: sel.filter((r) => eq(r.admin_call_status, 'answered')),
      appts,
      appointmentCompleted: sel.filter((r) => eq(r.advisor_call_status, 'answered')),
      noAnswer,
      recommendation: sel.filter((r) => stageAtOrBeyond(r, 'Advisor Recommendation')),
      apps: sel.filter((r) => eq(r.application_submission_status, 'submitted')),
      offers: sel.filter((r) => stageAtOrBeyond(r, 'Offer Issued')),
      completions,
      stuck: sel.filter((r) => isStuck(r)),
      won,
      lost,
      avgDays: avgDaysCreatedToCompletion(sel),
    }
  }, [m.selectedRows])

  const scope = advisor === 'all' ? 'All advisors' : advisor

  const drill = (title, drillRows, extra = []) => openDrilldown(title, drillRows, extra)

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))

  const stackData = m.grid.map((g) => ({
    name: g.name,
    open: g.openCount,
    won: g.won,
    lost: g.lostCount,
  }))

  // Pipeline Funnel — reuses the same kpi.* counts as the cards above (so
  // the chart can never disagree with them), plotted in funnel order so bar
  // length shows where the drop-off actually happens.
  const funnelData = [
    { stage: 'Cases Assigned', count: kpi.assigned.length },
    { stage: 'Contacted', count: kpi.contacted.length },
    { stage: 'Appointments Booked', count: kpi.appts.length },
    { stage: 'Appointment Completed', count: kpi.appointmentCompleted.length },
    { stage: 'To Recommendation', count: kpi.recommendation.length },
    { stage: 'Applications Submitted', count: kpi.apps.length },
    { stage: 'Offers Issued', count: kpi.offers.length },
    { stage: 'Completions', count: kpi.completions.length },
  ]

  // Advisor Contact Rate = Appointment Completed / Appointments Booked
  // (answered / all logged advisor calls), same definition as Call
  // Tracking's Contact Rate. Advisors with zero logged calls are excluded
  // rather than shown as a misleading 0%.
  const contactRateData = m.grid
    .map((g) => {
      const attempted = g.counts.appts.length
      const answered = g.counts.appointmentCompleted.length
      return { name: g.name, rate: attempted ? (100 * answered) / attempted : null, attempted, answered }
    })
    .filter((d) => d.rate !== null)
    .sort((a, b) => b.rate - a.rate)

  // Call Outcome Breakdown — status colors (good/critical/neutral), not
  // categorical identity, since these are literally call states.
  const outcomeAnswered = kpi.appointmentCompleted.length
  const outcomeNoAnswer = kpi.noAnswer.length
  const outcomeNotContacted = kpi.assigned.length - outcomeAnswered - outcomeNoAnswer
  const outcomeTotal = kpi.assigned.length
  const outcomeData = [{ name: 'outcome', answered: outcomeAnswered, noAnswer: outcomeNoAnswer, notContacted: outcomeNotContacted }]
  const outcomeLegend = [
    { key: 'answered', label: 'Answered', value: outcomeAnswered, color: '#6DA544' },
    { key: 'noAnswer', label: 'No Answer', value: outcomeNoAnswer, color: '#E91E63' },
    { key: 'notContacted', label: 'Not Contacted Yet', value: outcomeNotContacted, color: '#8896A6' },
  ]

  const gridCols = [
    { key: 'name', label: 'Advisor' },
    ...METRIC_DEFS.map((d) => ({ key: d.id, label: d.label })),
    { key: 'conv', label: 'Conversion %' },
    { key: 'closeRate', label: 'Close Rate %' },
    { key: 'avgDays', label: 'Avg Days' },
    { key: 'avgDocsChaseAttempts', label: 'Avg Docs Chase Attempts' },
  ]

  const popPct = m.baseCount ? (100 * m.populated) / m.baseCount : 0

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm text-muted">Advisor:</label>
        <select
          value={advisor}
          onChange={(e) => setAdvisor(e.target.value)}
          className="text-sm border border-line rounded-lg px-3 py-2 bg-card text-ink focus:outline-none focus:ring-2 focus:ring-brand-green/40"
        >
          <option value="all">All Advisors</option>
          {m.advisors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {!loading && (
        <div className="card px-4 py-3 flex items-center gap-2.5 bg-amber-50 border-amber-200">
          <AlertTriangle size={15} className="text-amber-700 shrink-0" />
          <p className="text-[13px] text-amber-800">
            Advisor field populated on <strong>{popPct.toFixed(1)}%</strong> of cases ({fmtInt(m.populated)} of{' '}
            {fmtInt(m.baseCount)}). This report only covers cases with a named advisor: unassigned cases are
            excluded from every KPI and the grid below, and counted separately in "{NO_ADVISOR}".
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KPICard
          label="Cases Assigned"
          value={fmtInt(kpi.assigned.length)}
          onClick={() => drill(`${scope}: ${fmtInt(kpi.assigned.length)} cases`, kpi.assigned)}
        />
        <KPICard
          label="Leads Contacted"
          value={fmtInt(kpi.contacted.length)}
          onClick={() =>
            drill(`${scope}: contacted`, kpi.contacted, [{ key: 'admin_call_status', label: 'Call Status' }])
          }
        />
        <KPICard
          label="Appointments Booked"
          value={fmtInt(kpi.appts.length)}
          onClick={() =>
            drill(`${scope}: appointments booked`, kpi.appts, [
              { key: 'advisor_call_status', label: 'Call Status' },
            ])
          }
        />
        <KPICard
          label="Appointment Completed"
          value={fmtInt(kpi.appointmentCompleted.length)}
          onClick={() =>
            drill(`${scope}: appointment completed`, kpi.appointmentCompleted, [
              { key: 'advisor_call_status', label: 'Call Status' },
            ])
          }
        />
        <KPICard
          label="No Answer Rate"
          value={fmtPct(kpi.noAnswer.length, kpi.appts.length)}
          sub={`${fmtInt(kpi.noAnswer.length)} of ${fmtInt(kpi.appts.length)} advisor calls`}
          onClick={() =>
            drill(`${scope}: no answer`, kpi.noAnswer, [{ key: 'advisor_call_status', label: 'Call Status' }])
          }
        />
        <KPICard
          label="Cases Progression to Recommendation"
          value={fmtInt(kpi.recommendation.length)}
          onClick={() =>
            drill(`${scope}: to recommendation`, kpi.recommendation, [
              { key: 'pipeline_stage', label: 'Pipeline Stage' },
            ])
          }
        />
        <KPICard
          label="Applications Submitted"
          value={fmtInt(kpi.apps.length)}
          onClick={() =>
            drill(`${scope}: applications`, kpi.apps, [
              { key: 'application_submission_status', label: 'Application' },
            ])
          }
        />
        <KPICard
          label="Offers Issued"
          value={fmtInt(kpi.offers.length)}
          onClick={() => drill(`${scope}: offers issued`, kpi.offers)}
        />
        <KPICard
          label="Completions"
          value={fmtInt(kpi.completions.length)}
          onClick={() =>
            drill(`${scope}: completions`, kpi.completions, [
              { key: 'completion_date', label: 'Completed', render: (r) => fmtDate(r.completion_date) },
            ])
          }
        />
        <KPICard
          label="Conversion Rate"
          value={fmtPct(kpi.completions.length, kpi.assigned.length)}
          sub={`${fmtInt(kpi.completions.length)} completed`}
        />
        <KPICard
          label="Close Rate"
          value={fmtPct(kpi.completions.length, kpi.completions.length + kpi.lost)}
          sub={`${fmtInt(kpi.completions.length)} won of ${fmtInt(kpi.completions.length + kpi.lost)} decided`}
        />
        <KPICard label="Avg Days to Completion" value={kpi.avgDays === null ? DASH : fmtDays(kpi.avgDays)} />
        <KPICard
          label="Cases Stuck / Flagged"
          value={fmtInt(kpi.stuck.length)}
          sub="open 30+ days, never past Appointment Booked"
          alert={kpi.stuck.length > 0}
          onClick={() =>
            drill(`${scope}: stuck / flagged`, kpi.stuck, [
              { key: 'pipeline_stage', label: 'Pipeline Stage' },
              { key: 'created_date', label: 'Created', render: (r) => fmtDate(r.created_date) },
            ])
          }
        />
        <KPICard
          label={NO_ADVISOR}
          value={fmtInt(m.unassignedRows.length)}
          sub={`${fmtInt(m.unassignedRows.length)} of ${fmtInt(m.baseCount)} total cases`}
          alert={m.unassignedRows.length > 0}
          onClick={() =>
            drill(NO_ADVISOR, m.unassignedRows, [
              { key: 'admin', label: 'Admin' },
              { key: 'created_date', label: 'Created', render: (r) => fmtDate(r.created_date) },
            ])
          }
        />
      </div>

      {loading ? (
        <div className="space-y-5">
          <Skeleton className="h-80" />
          <div className="grid lg:grid-cols-2 gap-5">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <ChartCard
            title="Lead Stages"
            subtitle={`${scope}: where cases drop off through the funnel. Click a bar to view records`}
          >
            <ResponsiveContainer width="100%" height={Math.max(280, funnelData.length * 40)}>
              <BarChart data={funnelData} layout="vertical" margin={{ top: 8, right: 48, left: 8 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
                <YAxis type="category" dataKey="stage" width={170} tick={{ fontSize: 11, fill: '#1F2937' }} />
                <Tooltip
                  cursor={{ fill: '#F7F9FB' }}
                  formatter={(v) => [`${fmtInt(v)} (${fmtPct(v, funnelData[0].count)})`, 'Cases']}
                />
                <Bar
                  dataKey="count"
                  fill="#6DA544"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(d) => {
                    // Map the clicked stage back to its underlying kpi.* row set
                    const byStage = {
                      'Cases Assigned': kpi.assigned,
                      Contacted: kpi.contacted,
                      'Appointments Booked': kpi.appts,
                      'Appointment Completed': kpi.appointmentCompleted,
                      'To Recommendation': kpi.recommendation,
                      'Applications Submitted': kpi.apps,
                      'Offers Issued': kpi.offers,
                      Completions: kpi.completions,
                    }
                    const stageRows = byStage[d.stage]
                    if (stageRows) drill(`${scope}: ${d.stage}`, stageRows)
                  }}
                >
                  <LabelList
                    dataKey="count"
                    position="right"
                    formatter={(v) => fmtInt(v)}
                    style={{ fill: '#1F2937', fontSize: 11, fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid lg:grid-cols-2 gap-5">
            <ChartCard title="Advisor Contact Rate" subtitle="Appointment Completed ÷ Appointments Booked, per advisor">
              {contactRateData.length ? (
                <ResponsiveContainer width="100%" height={Math.max(160, contactRateData.length * 44)}>
                  <BarChart data={contactRateData} layout="vertical" margin={{ top: 8, right: 40, left: 8 }}>
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 11, fill: '#6B7280' }}
                    />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: '#1F2937' }} />
                    <Tooltip
                      cursor={{ fill: '#F7F9FB' }}
                      formatter={(v, _name, p) => [
                        `${v.toFixed(1)}% (${p.payload.answered} of ${p.payload.attempted})`,
                        'Contact Rate',
                      ]}
                    />
                    <Bar dataKey="rate" fill="#6DA544" radius={[0, 4, 4, 0]}>
                      <LabelList
                        dataKey="rate"
                        position="right"
                        formatter={(v) => `${v.toFixed(0)}%`}
                        style={{ fill: '#1F2937', fontSize: 11, fontWeight: 600 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted py-8 text-center">No advisor calls logged yet</p>
              )}
            </ChartCard>

            <ChartCard title="Call Outcome Breakdown" subtitle={`${scope}: advisor_call_status across all cases`}>
              <ResponsiveContainer width="100%" height={70}>
                <BarChart data={outcomeData} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                  <XAxis type="number" hide domain={[0, outcomeTotal || 1]} />
                  <YAxis type="category" dataKey="name" hide />
                  <Tooltip
                    cursor={{ fill: '#F7F9FB' }}
                    formatter={(v, dataKeyName) => [
                      `${fmtInt(v)} (${fmtPct(v, outcomeTotal)})`,
                      outcomeLegend.find((o) => o.key === dataKeyName)?.label ?? dataKeyName,
                    ]}
                  />
                  <Bar dataKey="answered" stackId="s" fill="#6DA544" radius={[4, 0, 0, 4]} stroke="#FFFFFF" strokeWidth={2} />
                  <Bar dataKey="noAnswer" stackId="s" fill="#E91E63" stroke="#FFFFFF" strokeWidth={2} />
                  <Bar dataKey="notContacted" stackId="s" fill="#8896A6" radius={[0, 4, 4, 0]} stroke="#FFFFFF" strokeWidth={2} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3">
                {outcomeLegend.map((o) => (
                  <div key={o.key} className="flex items-center gap-1.5 text-xs">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: o.color }} />
                    <span className="text-ink font-medium">{o.label}</span>
                    <span className="text-muted">
                      {fmtInt(o.value)} ({fmtPct(o.value, outcomeTotal)})
                    </span>
                  </div>
                ))}
              </div>
            </ChartCard>
          </div>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-[480px]" />
      ) : (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink mb-1">1:1 Review Grid</h3>
          <p className="text-xs text-muted mb-4">One row per advisor. Click any count to view the records behind it</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-page">
                  {gridCols.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      className="px-3 py-2.5 font-medium text-xs text-muted whitespace-nowrap cursor-pointer select-none hover:text-ink"
                    >
                      {c.label}
                      {sort.key === c.key && (sort.dir === 'asc' ? ' ↑' : ' ↓')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.grid.map((g) => (
                  <tr key={g.name} className="border-t border-line/70 hover:bg-page/40">
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">{g.name}</td>
                    {METRIC_DEFS.map((d) => {
                      const cellRows = g.counts[d.id]
                      return (
                        <td key={d.id} className="px-3 py-2.5">
                          <button
                            className={`tabular-nums ${
                              cellRows.length
                                ? 'text-ink hover:text-brand-green hover:underline underline-offset-2'
                                : 'text-muted/60 cursor-default'
                            }`}
                            onClick={
                              cellRows.length
                                ? () => drill(`${g.name}: ${d.label} (${fmtInt(cellRows.length)})`, cellRows)
                                : undefined
                            }
                          >
                            {fmtInt(cellRows.length)}
                          </button>
                        </td>
                      )
                    })}
                    <td className="px-3 py-2.5 tabular-nums">{fmtPct(g.completions, g.own.length)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtPct(g.completions, g.closeRateDenom)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{g.avgDays === null ? DASH : fmtDays(g.avgDays)}</td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {g.avgDocsChaseAttempts === null ? DASH : g.avgDocsChaseAttempts.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        <ChartCard
          title="Cases per Advisor by Status"
          subtitle="open / won / lost"
          className="lg:col-span-2"
        >
          <ResponsiveContainer width="100%" height={Math.max(260, stackData.length * 30)}>
            <BarChart data={stackData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#1F2937' }} />
              <Tooltip cursor={{ fill: '#F7F9FB' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="open" stackId="s" fill="#5B7B94" />
              <Bar dataKey="won" stackId="s" fill="#6DA544" />
              <Bar dataKey="lost" stackId="s" fill="#8896A6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="space-y-4">
          <KPICard
            label="Claw Back Risk"
            value={fmtInt(m.clawBack.length)}
            sub="live policies started in the last 24 months"
            alert={m.clawBack.length > 0}
            onClick={() =>
              drill(`Claw back risk: ${fmtInt(m.clawBack.length)} policies`, m.clawBack, [
                { key: 'protection_provider', label: 'Provider' },
                {
                  key: 'protection_start_date',
                  label: 'Policy Start',
                  render: (r) => fmtDate(r.protection_start_date),
                },
                { key: 'protection_premium', label: 'Premium' },
              ])
            }
          />
          <div className="card px-4 py-4">
            <p className="text-[13px] text-muted leading-relaxed">
              Policies cancelled within 24 months of start typically trigger commission claw-back.
              Keep these clients warm. Review contact cadence for everyone in this list.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
