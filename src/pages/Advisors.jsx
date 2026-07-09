import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { AlertTriangle } from 'lucide-react'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import Skeleton from '../components/Skeleton'
import { fmtInt, fmtPct, fmtDays, fmtDate, isBlank, parseDate as pd, DASH } from '../lib/format'
import { stageAtOrBeyond, avgDaysToCompletion, isOnHold, EXPECTED_ADMINS } from '../lib/metrics'

const eq = (v, target) => String(v).trim().toLowerCase() === target
const NO_ADVISOR = '(No advisor assigned)'
const advisorOf = (r) => {
  const v = String(r.advisor_name || '').trim()
  return v || NO_ADVISOR
}

const METRIC_DEFS = [
  { id: 'assigned', label: 'Cases Assigned', test: () => true },
  { id: 'contacted', label: 'Contacted', test: (r) => eq(r.admin_call_status, 'answered') },
  { id: 'appts', label: 'Appts Booked', test: (r) => stageAtOrBeyond(r, 'Appointment Booked') },
  { id: 'apps', label: 'Applications', test: (r) => eq(r.application_submission_status, 'submitted') },
  { id: 'mortgageDone', label: 'Mortgage Completed', test: (r) => !isBlank(r.completion_status) },
  { id: 'protectionDone', label: 'Protection Completed', test: (r) => eq(r.protection_status, 'submitted') },
  { id: 'lost', label: 'Declined / NPW', test: (r) => r.case_status === 'lost' },
  { id: 'onHold', label: 'On Hold', test: (r) => isOnHold(r) },
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
  const [adminFilter, setAdminFilter] = useState('all')
  const [sort, setSort] = useState({ key: 'assigned', dir: 'desc' })

  // Dropdown only ever offers the 4 valid handover-flow outcomes — see
  // ADMIN_FILTER_PROPS in lib/metrics.js for why. Anomalous admin values
  // stay fully visible in the grid/charts; they're just not a selectable
  // filter target here (surfaced instead on Case Management's "Needs
  // Review" panel).
  const admins = EXPECTED_ADMINS

  const m = useMemo(() => {
    // Admin is a cross-filter that narrows the whole page (e.g. "advisor
    // performance only for cases currently with Ben Robertson"); the
    // advisor dropdown options themselves stay fixed to the full dataset
    // so switching admins never hides an advisor from the list.
    const baseRows = adminFilter === 'all' ? rows : rows.filter((r) => r.admin === adminFilter)

    // Advisor list is always derived from the full dataset (not baseRows) so
    // the dropdown/grid rows stay stable as the admin filter changes —
    // an advisor with 0 cases under the current admin just shows zero counts.
    const named = [...new Set(rows.map(advisorOf).filter((v) => v !== NO_ADVISOR))].sort()
    const hasUnassigned = rows.some((r) => advisorOf(r) === NO_ADVISOR)
    const advisors = hasUnassigned ? [...named, NO_ADVISOR] : named
    const selectedRows = advisor === 'all' ? baseRows : baseRows.filter((r) => advisorOf(r) === advisor)

    const populated = baseRows.filter((r) => !isBlank(r.advisor_name)).length

    const grid = advisors.map((name) => {
      const own = baseRows.filter((r) => advisorOf(r) === name)
      const counts = {}
      for (const def of METRIC_DEFS) counts[def.id] = own.filter(def.test)
      const won = own.filter((r) => r.case_status === 'won').length
      return {
        name,
        own,
        counts,
        won,
        conv: own.length ? won / own.length : null,
        avgDays: avgDaysToCompletion(own),
        openCount: own.filter((r) => r.case_status === 'open').length,
        lostCount: own.filter((r) => r.case_status === 'lost').length,
      }
    })

    const sorted = [...grid].sort((a, b) => {
      const val = (g) => {
        if (sort.key === 'name') return g.name
        if (sort.key === 'conv') return g.conv ?? -1
        if (sort.key === 'avgDays') return g.avgDays ?? Infinity
        return g.counts[sort.key]?.length ?? 0
      }
      const av = val(a)
      const bv = val(b)
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sort.dir === 'asc' ? cmp : -cmp
    })

    const clawBack = clawBackRisk(selectedRows)
    return { advisors, selectedRows, grid: sorted, clawBack, populated, baseCount: baseRows.length }
  }, [rows, advisor, adminFilter, sort])

  const kpi = useMemo(() => {
    const sel = m.selectedRows
    const won = sel.filter((r) => r.case_status === 'won').length
    return {
      assigned: sel,
      contacted: sel.filter((r) => eq(r.admin_call_status, 'answered')),
      appts: sel.filter((r) => stageAtOrBeyond(r, 'Appointment Booked')),
      apps: sel.filter((r) => eq(r.application_submission_status, 'submitted')),
      completions: sel.filter((r) => !isBlank(r.completion_status)),
      won,
      avgDays: avgDaysToCompletion(sel),
    }
  }, [m.selectedRows])

  const scope = [
    advisor === 'all' ? 'All advisors' : advisor,
    adminFilter === 'all' ? null : `admin: ${adminFilter}`,
  ]
    .filter(Boolean)
    .join(', ')

  const drill = (title, drillRows, extra = []) => openDrilldown(title, drillRows, extra)

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))

  const stackData = m.grid.map((g) => ({
    name: g.name,
    open: g.openCount,
    won: g.won,
    lost: g.lostCount,
  }))

  const gridCols = [
    { key: 'name', label: 'Advisor' },
    ...METRIC_DEFS.map((d) => ({ key: d.id, label: d.label })),
    { key: 'conv', label: 'Conversion %' },
    { key: 'avgDays', label: 'Avg Days' },
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

        <label className="text-sm text-muted">Admin:</label>
        <select
          value={adminFilter}
          onChange={(e) => setAdminFilter(e.target.value)}
          className="text-sm border border-line rounded-lg px-3 py-2 bg-card text-ink focus:outline-none focus:ring-2 focus:ring-brand-green/40"
        >
          <option value="all">All Admins</option>
          {admins.map((a) => (
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
            {fmtInt(m.baseCount)}). This determines how usable this page is right now. Unpopulated cases are
            grouped under "{NO_ADVISOR}" below rather than dropped.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
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
          onClick={() => drill(`${scope}: appointments booked`, kpi.appts)}
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
          label="Completions"
          value={fmtInt(kpi.completions.length)}
          onClick={() =>
            drill(`${scope}: completions`, kpi.completions, [
              { key: 'completion_date', label: 'Completed', render: (r) => fmtDate(r.completion_date) },
            ])
          }
        />
        <KPICard label="Conversion Rate" value={fmtPct(kpi.won, kpi.assigned.length)} sub={`${fmtInt(kpi.won)} won`} />
        <KPICard label="Avg Days to Completion" value={kpi.avgDays === null ? DASH : fmtDays(kpi.avgDays)} />
      </div>

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
                    <td className="px-3 py-2.5 tabular-nums">{fmtPct(g.won, g.own.length)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{g.avgDays === null ? DASH : fmtDays(g.avgDays)}</td>
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
