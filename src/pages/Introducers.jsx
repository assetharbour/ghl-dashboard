import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import Skeleton from '../components/Skeleton'
import { fmtInt, fmtPct, fmtDate, fmtCurrency, isBlank, DASH } from '../lib/format'
import { countBy, inCurrentMonth } from '../lib/metrics'

const MIN_LEADS_FOR_CONVERSION = 3

// Revenue = total_revenue summed across leads, but only counted as "has
// data" if at least one underlying case actually recorded a fee — an
// introducer/negotiator with zero recorded cases shows "—", never "£0",
// so an unconfirmed revenue reads differently from a genuinely-zero one.
function revenueStats(leads) {
  const recorded = leads.filter((r) => !isBlank(r.total_revenue))
  const sum = recorded.reduce((acc, r) => acc + Number(r.total_revenue), 0)
  return { hasData: recorded.length > 0, sum, recordedCount: recorded.length }
}

// Composite Performance score — weighted blend of volume, conversion rate,
// and revenue, each normalised 0-1 against the best introducer in the
// current dataset for that dimension:
//   score = (0.40 × volume) + (0.35 × conversion) + (0.25 × revenue)
// Conversion is dropped from the blend below MIN_LEADS_FOR_CONVERSION (too
// noisy on tiny samples, same threshold as "Best Conversion Rate" above).
// Revenue is dropped when the introducer has zero recorded-fee cases
// (unmeasured, not zero — see revenueStats). Weights are re-normalised
// across whichever components remain, so an introducer missing revenue
// data isn't penalised for it. Tiers: High >= 0.66, Medium >= 0.33, else Low.
const PERFORMANCE_WEIGHTS = { volume: 0.4, conversion: 0.35, revenue: 0.25 }

function performanceScore(s, maxCount, maxRevenue) {
  const components = [{ weight: PERFORMANCE_WEIGHTS.volume, value: maxCount ? s.count / maxCount : 0 }]
  if (s.count >= MIN_LEADS_FOR_CONVERSION) {
    components.push({ weight: PERFORMANCE_WEIGHTS.conversion, value: s.conv })
  }
  if (s.revenue.hasData && maxRevenue > 0) {
    components.push({ weight: PERFORMANCE_WEIGHTS.revenue, value: s.revenue.sum / maxRevenue })
  }
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0)
  if (!totalWeight) return { score: null, tier: null }
  const score = components.reduce((sum, c) => sum + c.weight * c.value, 0) / totalWeight
  const tier = score >= 0.66 ? 'High' : score >= 0.33 ? 'Medium' : 'Low'
  return { score, tier }
}

function PerformanceBadge({ tier }) {
  if (!tier) return <span className="text-muted">{DASH}</span>
  const cls =
    tier === 'High'
      ? 'bg-brand-green/10 text-brand-green'
      : tier === 'Medium'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-brand-pink/10 text-brand-pink'
  return <span className={`inline-block text-xs font-medium rounded-full px-2.5 py-0.5 ${cls}`}>{tier}</span>
}

export default function Introducers() {
  const { rows, loading, openDrilldown } = useData()
  const [expanded, setExpanded] = useState(null)

  const m = useMemo(() => {
    const named = rows.filter((r) => String(r.lead_source).trim() !== '')
    const bySource = new Map()
    for (const r of named) {
      if (!bySource.has(r.lead_source)) bySource.set(r.lead_source, [])
      bySource.get(r.lead_source).push(r)
    }
    const statsBase = [...bySource.entries()]
      .map(([source, leads]) => {
        const won = leads.filter((r) => r.case_status === 'won').length
        const lost = leads.filter((r) => r.case_status === 'lost').length
        const open = leads.filter((r) => r.case_status === 'open').length
        return { source, leads, count: leads.length, won, lost, open, conv: won / leads.length, revenue: revenueStats(leads) }
      })
      .sort((a, b) => b.count - a.count)

    const maxCount = statsBase.length ? Math.max(...statsBase.map((s) => s.count)) : 0
    const revenueSums = statsBase.filter((s) => s.revenue.hasData).map((s) => s.revenue.sum)
    const maxRevenue = revenueSums.length ? Math.max(...revenueSums) : 0
    const stats = statsBase.map((s) => ({ ...s, performance: performanceScore(s, maxCount, maxRevenue) }))

    const top = stats[0] || null
    const bestConv =
      [...stats]
        .filter((s) => s.count >= MIN_LEADS_FOR_CONVERSION)
        .sort((a, b) => b.conv - a.conv)[0] || null
    const thisMonth = named.filter((r) => inCurrentMonth(r.created_date))

    const totalRevenue = revenueStats(rows)
    const revenuePopPct = rows.length ? (100 * rows.filter((r) => !isBlank(r.total_revenue)).length) / rows.length : 0

    return { stats, top, bestConv, thisMonth, totalIntroducers: stats.length, totalRevenue, revenuePopPct }
  }, [rows])

  const drillIntroducer = (s) =>
    openDrilldown(`${s.source}: ${fmtInt(s.count)} leads`, s.leads, [
      { key: 'negotiator', label: 'Negotiator' },
      { key: 'created_date', label: 'Created', render: (r) => fmtDate(r.created_date) },
    ])

  const chartData = m.stats.map((s) => ({ name: s.source, count: s.count }))
  const chartHeight = Math.max(240, chartData.length * 34)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <KPICard label="Total Introducers" value={fmtInt(m.totalIntroducers)} sub="distinct lead sources" />
        <KPICard
          label="Top Introducer"
          value={m.top ? m.top.source : DASH}
          sub={m.top ? `${fmtInt(m.top.count)} leads` : undefined}
          onClick={m.top ? () => drillIntroducer(m.top) : undefined}
        />
        <KPICard
          label="Best Conversion Rate"
          value={m.bestConv ? fmtPct(m.bestConv.won, m.bestConv.count) : DASH}
          sub={m.bestConv ? `${m.bestConv.source} (min ${MIN_LEADS_FOR_CONVERSION} leads)` : `min ${MIN_LEADS_FOR_CONVERSION} leads`}
          onClick={m.bestConv ? () => drillIntroducer(m.bestConv) : undefined}
        />
        <KPICard
          label="Leads This Month"
          value={fmtInt(m.thisMonth.length)}
          onClick={() =>
            openDrilldown(`Leads this month: ${fmtInt(m.thisMonth.length)}`, m.thisMonth, [
              { key: 'created_date', label: 'Created', render: (r) => fmtDate(r.created_date) },
            ])
          }
        />
        <KPICard
          label="Total Revenue"
          value={m.totalRevenue.hasData ? fmtCurrency(m.totalRevenue.sum) : DASH}
          sub={`${fmtInt(m.totalRevenue.recordedCount)} of ${fmtInt(rows.length)} cases recorded`}
        />
      </div>

      <ChartCard title="Leads per Introducer" subtitle="Click a bar to view that introducer's leads">
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
            <YAxis
              type="category"
              dataKey="name"
              width={190}
              tick={{ fontSize: 11, fill: '#1F2937' }}
              // Recharts auto-wraps long category labels onto multiple lines
              // constrained to `width`, but the fixed 34px row height only
              // fits one — long introducer names (e.g. "Steve Whittington
              // (Simple Property Finance Ltd)") wrapped and overlapped the
              // bar above/below. Truncating keeps every row single-line; the
              // full name still shows in the tooltip and in the drilldown title.
              tickFormatter={(v) => (v.length > 28 ? `${v.slice(0, 28)}…` : v)}
            />
            <Tooltip cursor={{ fill: '#F7F9FB' }} formatter={(v) => [fmtInt(v), 'Leads']} />
            <Bar
              dataKey="count"
              fill="#6DA544"
              radius={[0, 4, 4, 0]}
              cursor="pointer"
              onClick={(d) => {
                const s = m.stats.find((x) => x.source === d.name)
                if (s) drillIntroducer(s)
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {loading ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink mb-1">Introducer Performance</h3>
          <p className="text-xs text-muted mb-4">Click a row to expand the negotiator and advisor breakdown</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-page">
                  <th className="px-3 py-2.5 font-medium text-xs text-muted">Introducer</th>
                  <th className="px-3 py-2.5 font-medium text-xs text-muted text-right">Leads</th>
                  <th className="px-3 py-2.5 font-medium text-xs text-muted text-right">Won</th>
                  <th className="px-3 py-2.5 font-medium text-xs text-muted text-right">Lost</th>
                  <th className="px-3 py-2.5 font-medium text-xs text-muted text-right">Open</th>
                  <th className="px-3 py-2.5 font-medium text-xs text-muted text-right">Conversion %</th>
                  <th className="px-3 py-2.5 font-medium text-xs text-muted text-right">Revenue</th>
                  <th className="px-3 py-2.5 font-medium text-xs text-muted text-right">Performance</th>
                </tr>
              </thead>
              <tbody>
                {m.stats.map((s) => {
                  const isOpen = expanded === s.source
                  const byNegotiator = isOpen
                    ? [...countBy(s.leads, (r) => r.negotiator || '(No negotiator)').entries()]
                        .map(([neg, count]) => ({
                          neg,
                          count,
                          revenue: revenueStats(s.leads.filter((r) => (r.negotiator || '(No negotiator)') === neg)),
                        }))
                        .sort((a, b) => b.count - a.count)
                    : []
                  const byAdvisor = isOpen
                    ? [...countBy(s.leads, (r) => r.advisor_name || '(No advisor assigned)').entries()].sort(
                        (a, b) => b[1] - a[1]
                      )
                    : []
                  return [
                    <tr
                      key={s.source}
                      onClick={() => setExpanded(isOpen ? null : s.source)}
                      className="border-t border-line/70 cursor-pointer hover:bg-page/60"
                    >
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          {isOpen ? (
                            <ChevronDown size={14} className="text-muted" />
                          ) : (
                            <ChevronRight size={14} className="text-muted" />
                          )}
                          {s.source}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{fmtInt(s.count)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtInt(s.won)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtInt(s.lost)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtInt(s.open)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtPct(s.won, s.count)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {s.revenue.hasData ? fmtCurrency(s.revenue.sum) : <span className="text-muted">{DASH}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <PerformanceBadge tier={s.performance.tier} />
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={s.source + '__detail'} className="bg-page/50">
                        <td colSpan={8} className="px-3 py-3">
                          <div className="grid sm:grid-cols-2 gap-6">
                            <div className="pl-6 space-y-1.5">
                              <p className="text-xs font-medium text-muted mb-2">By negotiator</p>
                              {byNegotiator.map(({ neg, count, revenue }) => (
                                <div key={neg} className="flex items-center gap-3 text-xs">
                                  <span className="text-ink">{neg}</span>
                                  <span className="flex-1 border-b border-dotted border-line" />
                                  <span className="text-muted">{fmtInt(count)} lead{count > 1 ? 's' : ''}</span>
                                  <span className="text-muted w-20 text-right">
                                    {revenue.hasData ? fmtCurrency(revenue.sum) : DASH}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <div className="pl-6 space-y-1.5">
                              <p className="text-xs font-medium text-muted mb-2">By advisor</p>
                              {byAdvisor.map(([adv, count]) => (
                                <div key={adv} className="flex items-center gap-3 text-xs">
                                  <span className="text-ink">{adv}</span>
                                  <span className="flex-1 border-b border-dotted border-line" />
                                  <span className="text-muted">{fmtInt(count)} lead{count > 1 ? 's' : ''}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ),
                  ]
                })}
                {!m.stats.length && (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-muted">
                      No records
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted mt-3">
            Revenue shown only reflects cases where fee fields have been recorded — {m.revenuePopPct.toFixed(1)}% of
            cases currently have this data.
          </p>
        </div>
      )}
    </div>
  )
}
