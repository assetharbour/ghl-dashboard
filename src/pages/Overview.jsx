import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import DataTable from '../components/DataTable'
import Skeleton from '../components/Skeleton'
import { fmtInt, fmtPct, fmtDays, fmtDate, parseDate } from '../lib/format'
import { STAGE_ORDER, CHART_COLORS, countBy, avgDaysToCompletion, inCurrentMonth } from '../lib/metrics'

const TOP_SOURCES = 8

export default function Overview() {
  const { rows, loading, openDrilldown } = useData()

  const m = useMemo(() => {
    const active = rows.filter((r) => r.case_status === 'open')
    const completionsMonth = rows.filter((r) => inCurrentMonth(r.completion_date))
    // Conversion = reached the "Completion" pipeline stage, same definition
    // as Advisor Performance and Introducer Reports — not case_status,
    // which can read "won" without the case ever reaching Completion.
    const completions = rows.filter((r) => r.pipeline_stage === 'Completion')
    const avgDays = avgDaysToCompletion(rows)

    const stageCounts = countBy(rows, (r) => r.pipeline_stage)
    const funnel = STAGE_ORDER.map((stage) => ({
      stage,
      count: stageCounts.get(stage) || 0,
    }))

    const sourceCounts = [...countBy(rows, (r) => r.lead_source || '(No source)').entries()].sort(
      (a, b) => b[1] - a[1]
    )
    const topSources = sourceCounts.slice(0, TOP_SOURCES).map(([name, value]) => ({ name, value }))
    const otherCount = sourceCounts.slice(TOP_SOURCES).reduce((a, [, v]) => a + v, 0)
    const donut = otherCount > 0 ? [...topSources, { name: 'Other', value: otherCount }] : topSources
    const otherSources = new Set(sourceCounts.slice(TOP_SOURCES).map(([name]) => name))

    const recent = [...rows]
      .filter((r) => parseDate(r.created_date))
      .sort((a, b) => parseDate(b.created_date) - parseDate(a.created_date))
      .slice(0, 10)

    return { active, completionsMonth, completions, avgDays, funnel, donut, otherSources, recent }
  }, [rows])

  const drillStage = (stage) =>
    openDrilldown(
      `${stage}: ${fmtInt(m.funnel.find((f) => f.stage === stage)?.count || 0)} cases`,
      rows.filter((r) => r.pipeline_stage === stage),
      [{ key: 'created_date', label: 'Created', render: (r) => fmtDate(r.created_date) }]
    )

  const drillSource = (name) => {
    const match =
      name === 'Other'
        ? rows.filter((r) => m.otherSources.has(r.lead_source || '(No source)'))
        : rows.filter((r) => (r.lead_source || '(No source)') === name)
    openDrilldown(`${name}: ${fmtInt(match.length)} leads`, match, [
      { key: 'created_date', label: 'Created', render: (r) => fmtDate(r.created_date) },
    ])
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KPICard
          label="Total Active Cases"
          value={fmtInt(m.active.length)}
          onClick={() =>
            openDrilldown(`Active cases: ${fmtInt(m.active.length)}`, m.active, [
              { key: 'created_date', label: 'Created', render: (r) => fmtDate(r.created_date) },
            ])
          }
        />
        <KPICard
          label="Completions This Month"
          value={fmtInt(m.completionsMonth.length)}
          onClick={() =>
            openDrilldown(
              `Completions this month: ${fmtInt(m.completionsMonth.length)}`,
              m.completionsMonth,
              [{ key: 'completion_date', label: 'Completed', render: (r) => fmtDate(r.completion_date) }]
            )
          }
        />
        <KPICard
          label="Total Leads"
          value={fmtInt(rows.length)}
          onClick={() =>
            openDrilldown(`All leads: ${fmtInt(rows.length)}`, rows, [
              { key: 'created_date', label: 'Created', render: (r) => fmtDate(r.created_date) },
            ])
          }
        />
        <KPICard
          label="Conversion Rate"
          value={fmtPct(m.completions.length, rows.length)}
          sub={`${fmtInt(m.completions.length)} completed`}
          onClick={() =>
            openDrilldown(`Completed cases: ${fmtInt(m.completions.length)}`, m.completions, [
              { key: 'completion_date', label: 'Completed', render: (r) => fmtDate(r.completion_date) },
            ])
          }
        />
        <KPICard
          label="Avg Days Lead → Completion"
          value={m.avgDays === null ? '—' : fmtDays(m.avgDays)}
          sub="cases with full journey data"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <ChartCard title="Pipeline Funnel" subtitle="Cases per stage, in pipeline order. Click a bar to view records">
          <ResponsiveContainer width="100%" height={420}>
            <BarChart data={m.funnel} layout="vertical" margin={{ left: 8, right: 24 }}>
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis
                type="category"
                dataKey="stage"
                width={170}
                tick={{ fontSize: 11, fill: '#1F2937' }}
              />
              <Tooltip cursor={{ fill: '#F7F9FB' }} formatter={(v) => [fmtInt(v), 'Cases']} />
              <Bar
                dataKey="count"
                fill="#6DA544"
                radius={[0, 4, 4, 0]}
                cursor="pointer"
                onClick={(d) => drillStage(d.stage)}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Leads by Source" subtitle="Top 8 sources. Click a segment to view records">
          <ResponsiveContainer width="100%" height={420}>
            <PieChart>
              <Pie
                data={m.donut}
                dataKey="value"
                nameKey="name"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={2}
                cursor="pointer"
                onClick={(d) => drillSource(d.name)}
              >
                {m.donut.map((entry, i) => (
                  <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v, n) => [fmtInt(v), n]} />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {loading ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink mb-4">Recent Activity</h3>
          <DataTable
            searchable={false}
            pageSize={10}
            columns={[
              { key: 'client_name', label: 'Client' },
              { key: 'lead_source', label: 'Lead Source' },
              { key: 'pipeline_stage', label: 'Stage' },
              { key: 'admin', label: 'Admin' },
              {
                key: 'created_date',
                label: 'Created',
                render: (r) => fmtDate(r.created_date),
                sortValue: (r) => parseDate(r.created_date)?.getTime() ?? null,
              },
            ]}
            rows={m.recent}
          />
        </div>
      )}
    </div>
  )
}
