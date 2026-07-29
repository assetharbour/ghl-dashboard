import { useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import DataTable from '../components/DataTable'
import Skeleton from '../components/Skeleton'
import { fmtInt, fmtPct, fmtDate, parseDate, displayValue } from '../lib/format'
import { isMortgageCase, hasProtection, ADMIN_FILTER_PROPS } from '../lib/metrics'

export default function Gapping() {
  const { rows, loading, openDrilldown } = useData()

  const m = useMemo(() => {
    const mortgage = rows.filter(isMortgageCase)
    const unprotected = mortgage.filter((r) => !hasProtection(r))
    const protectedCases = mortgage.filter(hasProtection)

    const workList = [...unprotected].sort((a, b) => {
      const ad = parseDate(a.completion_date)?.getTime() ?? -Infinity
      const bd = parseDate(b.completion_date)?.getTime() ?? -Infinity
      return bd - ad
    })

    return { mortgage, unprotected, protectedCases, workList }
  }, [rows])

  const donut = [
    { name: 'Protected', value: m.protectedCases.length, rows: m.protectedCases },
    { name: 'Unprotected', value: m.unprotected.length, rows: m.unprotected },
  ]
  const DONUT_COLORS = ['#6DA544', '#E91E63']

  const protectionCols = [
    { key: 'mortgage_case_type', label: 'Case Type' },
    { key: 'protection_type', label: 'Protection Type' },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <KPICard
          label="Mortgage: No Protection"
          value={fmtInt(m.unprotected.length)}
          alert={m.unprotected.length > 0}
          onClick={() =>
            openDrilldown(
              `Unprotected mortgage cases: ${fmtInt(m.unprotected.length)}`,
              m.unprotected,
              protectionCols
            )
          }
        />
        <KPICard
          label="Protection Attached"
          value={fmtInt(m.protectedCases.length)}
          onClick={() =>
            openDrilldown(
              `Protected mortgage cases: ${fmtInt(m.protectedCases.length)}`,
              m.protectedCases,
              protectionCols
            )
          }
        />
        <KPICard
          label="Gapping Rate"
          value={fmtPct(m.unprotected.length, m.mortgage.length)}
          sub={`${fmtInt(m.mortgage.length)} mortgage cases total`}
        />
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        <ChartCard title="Mortgage to Protection" subtitle="click a segment to view records" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={donut}
                dataKey="value"
                nameKey="name"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={2}
                cursor="pointer"
                onClick={(d) =>
                  openDrilldown(
                    `${d.name} mortgage cases: ${fmtInt(d.value)}`,
                    d.name === 'Protected' ? m.protectedCases : m.unprotected,
                    protectionCols
                  )
                }
              >
                {donut.map((entry, i) => (
                  <Cell key={entry.name} fill={DONUT_COLORS[i]} />
                ))}
              </Pie>
              <Tooltip formatter={(v, n) => [fmtInt(v), n]} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {loading ? (
          <Skeleton className="h-96 lg:col-span-3" />
        ) : (
          <div className="card p-5 lg:col-span-3">
            <h3 className="text-sm font-semibold text-ink mb-1">Gapping Work List</h3>
            <p className="text-xs text-muted mb-4">
              Unprotected mortgage cases, most recent completions first (warmest cross-sell)
            </p>
            <DataTable
              columns={[
                { key: 'client_name', label: 'Client' },
                { key: 'mortgage_case_type', label: 'Case Type' },
                {
                  key: 'completion_date',
                  label: 'Completed',
                  render: (r) => fmtDate(r.completion_date),
                  sortValue: (r) => parseDate(r.completion_date)?.getTime() ?? null,
                },
                { key: 'admin', label: 'Admin' },
                {
                  key: 'admin_call_attempt_count',
                  label: 'Call Attempts',
                  render: (r) => displayValue(r.admin_call_attempt_count),
                },
                { key: 'client_relationship_status', label: 'Relationship' },
              ]}
              rows={m.workList}
              filters={[
                { key: 'admin', label: 'Admin', ...ADMIN_FILTER_PROPS },
                { key: 'advisor_name', label: 'Advisor', blankLabel: '(No advisor assigned)' },
              ]}
              pageSize={25}
              exportName="gapping_work_list"
            />
          </div>
        )}
      </div>
    </div>
  )
}
