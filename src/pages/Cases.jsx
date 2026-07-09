import { useMemo, useState } from 'react'
import { useData } from '../context/DataContext'
import DataTable from '../components/DataTable'
import Skeleton from '../components/Skeleton'
import { fmtInt, fmtDate, parseDate, displayValue, DASH } from '../lib/format'
import { isOnHold, isStuck, isAnomalousAdmin, ADMIN_FILTER_PROPS } from '../lib/metrics'

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

  const m = useMemo(() => {
    const queues = QUEUES.map((q) => ({ ...q, rows: rows.filter(q.test) }))

    const erc = rows
      .filter((r) => parseDate(r.erc_date) || parseDate(r.mortgage_product_roll_off_date))
      .map((r) => {
        const soonest = [parseDate(r.erc_date), parseDate(r.mortgage_product_roll_off_date)]
          .filter(Boolean)
          .sort((a, b) => a - b)[0]
        return { ...r, __soonest: soonest.getTime() }
      })
      .sort((a, b) => a.__soonest - b.__soonest)

    const anomalousAdmin = rows.filter((r) => isAnomalousAdmin(r.admin))

    return { queues, erc, anomalousAdmin }
  }, [rows])

  const active = m.queues.find((q) => q.id === activeQueue) || m.queues[0]

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
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
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
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
        <h3 className="text-sm font-semibold text-ink mb-4">
          Queue: {active.label} ({fmtInt(active.rows.length)})
        </h3>
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
            { key: 'lead_source', label: 'Lead Source' },
            {
              key: 'admin_call_attempt_count',
              label: 'Call Attempts',
              render: (r) => displayValue(r.admin_call_attempt_count),
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
        <h3 className="text-sm font-semibold text-ink mb-1">Admin Assignment: Needs Review</h3>
        <p className="text-xs text-muted mb-4 max-w-2xl">
          These cases show an admin who isn't part of the standard Lead Intake → Docs Received handover flow
          (Anita Andrews → Ben Robertson / Lewis Flude / Alison Gulliver). Likely a manual reassignment in GHL,
          worth reviewing with the team.
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
        <h3 className="text-sm font-semibold text-ink mb-1">ERC / Product Roll-off</h3>
        <p className="text-xs text-muted mb-4">
          Sorted soonest first: red within 30 days, amber within 90, green beyond
        </p>
        <DataTable
          columns={[
            { key: 'client_name', label: 'Client' },
            {
              key: 'erc_date',
              label: 'ERC Date',
              render: (r) => <ErcChip date={r.erc_date} />,
              sortValue: (r) => parseDate(r.erc_date)?.getTime() ?? Infinity,
            },
            {
              key: 'mortgage_product_roll_off_date',
              label: 'Roll-off Date',
              render: (r) => <ErcChip date={r.mortgage_product_roll_off_date} />,
              sortValue: (r) => parseDate(r.mortgage_product_roll_off_date)?.getTime() ?? Infinity,
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
          exportName="erc_roll_off"
        />
      </div>
    </div>
  )
}
