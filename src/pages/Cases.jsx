import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useData } from '../context/DataContext'
import DataTable from '../components/DataTable'
import Skeleton from '../components/Skeleton'
import { fmtInt, fmtDate, parseDate, displayValue, DASH } from '../lib/format'
import {
  isOnHold,
  isStuck,
  isAnomalousAdmin,
  productEndDate,
  ercForecast,
  isAwaitingClientResponse,
  isFindingPropertyCase,
  ADMIN_FILTER_PROPS,
} from '../lib/metrics'

const QUEUES = [
  { id: 'docs-requested', label: 'Docs Requested', test: (r) => r.pipeline_stage === 'Docs Requested' },
  {
    id: 'docs-received',
    label: 'Docs Received / Full Review',
    test: (r) => r.pipeline_stage === 'Docs Received / Full Review',
  },
  {
    id: 'interested',
    label: 'Interested / Not Ready',
    test: (r) => r.pipeline_stage === 'Interested / Not Ready',
  },
  {
    id: 'awaiting-client',
    label: 'Awaiting Client Response',
    test: (r) => isAwaitingClientResponse(r),
  },
  { id: 'finding-property', label: 'Finding Property', test: (r) => isFindingPropertyCase(r) },
  { id: 'lender', label: 'Lender Processing', test: (r) => r.pipeline_stage === 'Lender Processing' },
  { id: 'on-hold', label: 'On Hold', test: (r) => isOnHold(r) },
  { id: 'stuck', label: 'Stuck / Flagged', test: (r) => isStuck(r), alert: true },
]

function daysInState(row) {
  const created = parseDate(row.created_date)
  if (!created) return null
  return Math.floor((Date.now() - created.getTime()) / 86400000)
}

function ErcChip({ date }) {
  const d = parseDate(date)
  if (!d) return DASH
  const days = (d.getTime() - Date.now()) / 86400000
  const cls =
    days <= 30
      ? 'bg-brand-pink/10 text-brand-pink'
      : days <= 90
        ? 'bg-amber-100 text-amber-700'
        : 'bg-brand-green/10 text-brand-green'
  return (
    <span className={`inline-block text-xs font-medium rounded-full px-2.5 py-0.5 ${cls}`}>
      {fmtDate(d)}
    </span>
  )
}

const anomalousAdminCols = [
  { key: 'advisor_name', label: 'Advisor' },
  { key: 'admin_handover', label: 'Admin-Handover Field' },
  { key: 'created_date', label: 'Created', render: (r) => fmtDate(r.created_date) },
]

export default function Cases() {
  const { rows, loading, openDrilldown } = useData()
  const [activeQueue, setActiveQueue] = useState(QUEUES[0].id)
  const [forecastAdvisor, setForecastAdvisor] = useState('')

  const m = useMemo(() => {
    const queues = QUEUES.map((q) => ({ ...q, rows: rows.filter(q.test) }))

    // Upcoming product end dates only (an end date that has passed is not a renewal to chase), soonest first.
    const startOfToday = new Date().setHours(0, 0, 0, 0)
    const erc = rows
      .filter((r) => (parseDate(productEndDate(r))?.getTime() ?? -Infinity) >= startOfToday)
      .map((r) => ({ ...r, __productEnd: productEndDate(r), __soonest: parseDate(productEndDate(r)).getTime() }))
      .sort((a, b) => a.__soonest - b.__soonest)

    const anomalousAdmin = rows.filter((r) => isAnomalousAdmin(r.admin))

    return { queues, erc, anomalousAdmin }
  }, [rows])

  const active = m.queues.find((q) => q.id === activeQueue) || m.queues[0]
  const forecast = useMemo(() => ercForecast(rows, new Date(), forecastAdvisor), [rows, forecastAdvisor])
  const forecastAdvisors = useMemo(
    () => [...new Set(rows.map((r) => String(r.advisor_name ?? '').trim()).filter(Boolean))].sort(),
    [rows]
  )
  const forecastCols = [
    { key: '__productEnd', label: 'Product End Date (ERC)', render: (r) => fmtDate(r.__productEnd) },
    { key: 'advisor_name', label: 'Advisor' },
    { key: 'admin', label: 'Admin' },
  ]

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-8 gap-4">
          {QUEUES.map((q) => (
            <Skeleton key={q.id} className="h-[92px]" />
          ))}
        </div>
        <Skeleton className="h-96" />
        <Skeleton className="h-32" />
        <Skeleton className="h-80" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-8 gap-4">
        {m.queues.map((q) => {
          const isActive = q.id === active.id
          return (
            <button
              key={q.id}
              onClick={() => setActiveQueue(q.id)}
              className={`card px-4 py-3.5 text-left transition-colors ${
                isActive ? 'border-brand-green ring-1 ring-brand-green/40' : 'hover:border-brand-green/40'
              }`}
            >
              <div className="kpi-label">{q.label}</div>
              <div className={`text-2xl font-semibold mt-1 ${q.alert && q.rows.length ? 'text-brand-pink' : 'text-ink'}`}>
                {fmtInt(q.rows.length)}
              </div>
            </button>
          )
        })}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-ink mb-4">
          Queue: {active.label} ({fmtInt(active.rows.length)})
        </h2>
        <DataTable
          columns={[
            { key: 'client_name', label: 'Client' },
            { key: 'admin', label: 'Admin' },
            {
              key: '__days',
              label: 'Days in State',
              render: (r) => {
                const d = daysInState(r)
                return d === null ? DASH : fmtInt(d)
              },
              sortValue: (r) => daysInState(r) ?? -1,
            },
            {
              key: 'pipeline_stage',
              label: 'Stage',
              render: (r) => displayValue(r.pipeline_stage),
            },
            { key: 'lead_source', label: 'Lead Source' },
            {
              key: 'property_status',
              label: 'Property Status',
              render: (r) => displayValue(r.property_status),
            },
            {
              key: 'admin_call_attempt_count',
              label: 'Call Attempts',
              render: (r) => displayValue(r.admin_call_attempt_count),
            },
            {
              key: 'docs_chase_attempt_count',
              label: 'Docs Chase Attempts',
              render: (r) => displayValue(r.docs_chase_attempt_count),
            },
          ]}
          rows={active.rows}
          filters={[
            { key: 'admin', label: 'Admin', ...ADMIN_FILTER_PROPS },
            { key: 'advisor_name', label: 'Advisor', blankLabel: '(No advisor assigned)' },
          ]}
          pageSize={25}
          exportName={`queue_${active.id}`}
          initialSort={{ key: '__days', dir: 'desc' }}
        />
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-ink mb-1">Admin Assignment: Needs Review</h2>
        <p className="text-xs text-muted mb-4 max-w-2xl">
          These cases show an admin who isn't part of the standard handover flow: the sales team at stages 1 to 3
          (Ava Morris-Boundy, Harry Kalsi, Hugo Sharpe), then Anita Andrews, then Ben Robertson / Lewis Flude /
          Alison Gulliver. Likely a manual reassignment in GHL, worth reviewing with the team.
        </p>
        <button
          onClick={() =>
            openDrilldown(
              `Admin assignment needs review: ${fmtInt(m.anomalousAdmin.length)} cases`,
              m.anomalousAdmin,
              anomalousAdminCols
            )
          }
          className="text-left group"
          disabled={!m.anomalousAdmin.length}
        >
          <div
            className={`text-3xl font-semibold transition-opacity ${
              m.anomalousAdmin.length ? 'text-brand-pink group-hover:opacity-75' : 'text-ink'
            }`}
          >
            {fmtInt(m.anomalousAdmin.length)}
          </div>
          <div className="text-xs text-muted mt-1">
            {m.anomalousAdmin.length ? 'cases · click to review' : 'no anomalies found'}
          </div>
        </button>
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">ERC Renewal Forecast</h2>
            <p className="text-xs text-muted mt-0.5 max-w-2xl">
              Mortgages whose product ends (the ERC Date) from today to the end of {forecast.nextYearNo}, month by month. Only as
              complete as the ERC dates held in GHL. Click a bar or a number to see the clients.
            </p>
          </div>
          <label className="text-xs text-muted flex items-center gap-2">
            Advisor
            <select
              value={forecastAdvisor}
              onChange={(e) => setForecastAdvisor(e.target.value)}
              className="border border-line rounded-md bg-white text-ink text-sm px-2 py-1"
            >
              <option value="">All advisors</option>
              {forecastAdvisors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          {[
            ['Next 6 months', forecast.next6],
            [`All of ${forecast.nextYearNo}`, forecast.nextYear],
            ['Today to end of ' + forecast.nextYearNo, forecast.months.flatMap((mo) => mo.rows)],
          ].map(([label, list]) => (
            <button
              key={label}
              onClick={() => openDrilldown(`ERC renewals, ${label}: ${fmtInt(list.length)}`, list, forecastCols)}
              disabled={!list.length}
              className="text-left group"
            >
              <div className="kpi-label">{label}</div>
              <div className="text-2xl font-semibold text-ink group-hover:opacity-75">{fmtInt(list.length)}</div>
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={forecast.months.map((mo) => ({ name: mo.label, count: mo.rows.length, key: mo.key }))} margin={{ top: 8, right: 8 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#1F2937' }} interval={0} angle={-45} textAnchor="end" height={60} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
            <Tooltip cursor={{ fill: '#F7F9FB' }} formatter={(v) => [fmtInt(v), 'Product ends']} />
            <Bar
              dataKey="count"
              fill="#6DA544"
              radius={[4, 4, 0, 0]}
              cursor="pointer"
              onClick={(d) => {
                const mo = forecast.months.find((x) => x.key === d?.key)
                if (mo?.rows.length) openDrilldown(`ERC renewals, ${mo.label}: ${fmtInt(mo.rows.length)}`, mo.rows, forecastCols)
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-ink mb-1">Product Roll-off</h2>
        <p className="text-xs text-muted mb-4">
          Product end date (the ERC Date), upcoming only, soonest first: red within 30 days, amber within 90, green beyond
        </p>
        <DataTable
          columns={[
            { key: 'client_name', label: 'Client' },
            {
              key: '__productEnd',
              label: 'Product End Date (ERC)',
              render: (r) => <ErcChip date={r.__productEnd} />,
              sortValue: (r) => parseDate(r.__productEnd)?.getTime() ?? Infinity,
            },
            { key: 'admin', label: 'Admin' },
            { key: 'client_relationship_status', label: 'Relationship' },
          ]}
          rows={m.erc}
          filters={[
            { key: 'admin', label: 'Admin', ...ADMIN_FILTER_PROPS },
            { key: 'advisor_name', label: 'Advisor', blankLabel: '(No advisor assigned)' },
          ]}
          pageSize={25}
          exportName="product_roll_off"
        />
      </div>
    </div>
  )
}
