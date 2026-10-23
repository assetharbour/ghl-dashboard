import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Legend, Cell, CartesianGrid } from 'recharts'
import { Trophy, Zap, Info, ArrowUpRight } from 'lucide-react'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import Skeleton from '../components/Skeleton'
import { DASH, fmtInt, fmtCurrency, fmtDays, parseDate } from '../lib/format'
import { isAwaitingClientResponse, isStuck, productEndDate, rangeBounds } from '../lib/metrics'
import { contactInfoFromLeads } from '../lib/sales'
import {
  MIN_LEADS_FOR_SPEED, adminBoard, advisorBoard, completedInRange, fmtMinutes, funnel, headline, honours, introducerBoard, salesBoard, speedSummary, weeklyTrend,
} from '../lib/leadership'

const GREEN = '#6DA544'
const NAVY = '#2E3A48'
const PINK = '#E91E63'
const SPEED_COLORS = ['#6DA544', '#94C973', '#C7DDB5', '#F2A93B', PINK]

const pct = (r) => (r === null || r === undefined ? DASH : `${(r * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`)
const money = (v) => fmtCurrency(v)

const TEAMS = [
  { id: 'sales', label: 'Sales team', note: 'Harry, Ava and Hugo: appointments they booked and how those turned out' },
  { id: 'advisors', label: 'Advisors', note: 'Cases completed in the period, with the leads assigned to each advisor through the advisor field' },
  { id: 'admin', label: 'Handover team', note: 'Cases completed in the period, and the open cases each person holds right now' },
]

const MEDAL = ['bg-[#E8C547] text-[#5C4A00]', 'bg-[#C9D1DA] text-[#3B4652]', 'bg-[#D9A877] text-[#5A3A1A]']

// ----------------------------------------------------------------------------------------------------------- pieces

function Place({ place, earned }) {
  const medal = earned && place <= 3 ? MEDAL[place - 1] : 'bg-page text-muted border border-line'
  return <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${medal}`}>{place}</span>
}

/** One ranked list: a bar for the main measure and a few supporting figures per person. */
function Leaderboard({ rows, primary, stats, empty }) {
  if (!rows.length) return <p className="text-sm text-muted py-8 text-center">{empty}</p>
  const max = Math.max(...rows.map((r) => primary.value(r) || 0), 0)
  return (
    <ol className="divide-y divide-line">
      {rows.map((r) => {
        const v = primary.value(r) || 0
        return (
          <li key={r.name} className="py-3 grid gap-x-4 gap-y-2 xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] items-center">
            <div className="flex items-center gap-3 min-w-0">
              <Place place={r.place} earned={max > 0} />
              <span className="font-medium text-ink truncate">{r.name}</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-xs text-muted">{primary.label}</span>
                <span className="text-sm font-semibold text-ink">{primary.format(v)}</span>
              </div>
              <div className="h-2 rounded-full bg-page overflow-hidden" role="presentation">
                <div className="h-full rounded-full bg-brand-green" style={{ width: max ? `${Math.max(2, (v / max) * 100)}%` : '0%' }} />
              </div>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-1 text-xs xl:justify-items-end">
              {stats.map((s) => (
                <div key={s.label} className="xl:text-right">
                  <dt className="text-muted">{s.label}</dt>
                  <dd className="font-medium text-ink">{s.value(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        )
      })}
    </ol>
  )
}

function Honour({ icon: Icon, label, winner, value, sub }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Icon size={14} className="text-brand-green" />
        <span className="kpi-label">{label}</span>
      </div>
      {winner ? (
        <>
          <div className="mt-1.5 text-base font-semibold text-ink truncate" title={winner}>{winner}</div>
          <div className="text-sm text-[#3F7A1E] font-medium">{value}</div>
          {sub && <div className="text-xs text-muted">{sub}</div>}
        </>
      ) : (
        <>
          <div className="mt-1.5 text-base font-semibold text-muted">{DASH}</div>
          <div className="text-xs text-muted">{sub || 'No one yet'}</div>
        </>
      )}
    </div>
  )
}

function Tile({ to, label, value, sub, alert }) {
  return (
    <Link to={to} className="card px-4 py-3 hover:border-brand-green/50 transition-colors group flex items-start justify-between gap-3">
      <div>
        <div className="kpi-label">{label}</div>
        <div className={`text-2xl font-semibold mt-1 ${alert && value > 0 ? 'text-brand-pink' : 'text-ink'}`}>{fmtInt(value)}</div>
        <div className="text-xs text-muted mt-0.5">{sub}</div>
      </div>
      <ArrowUpRight size={14} className="text-muted/50 group-hover:text-brand-green transition-colors mt-1 shrink-0" />
    </Link>
  )
}

// -------------------------------------------------------------------------------------------------------------- page

export default function Leadership() {
  const { loading, rows, allRows, appointments, flags, callActivity, leadSpeed, dateRange, customRange, openDrilldown } = useData()
  const [team, setTeam] = useState('sales')

  // One clock per data load, so a render pass never mixes two moments.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [appointments, allRows])
  const { start, end } = useMemo(() => {
    const b = rangeBounds(dateRange, customRange, now)
    if (!b) return { start: null, end: null }
    return { start: b.from, end: b.to ? new Date(b.to.getTime() + (b.inclusiveTo ? 1 : 0)) : null }
  }, [dateRange, customRange, now])

  const m = useMemo(() => {
    const contacts = contactInfoFromLeads(allRows)
    const speed = speedSummary(leadSpeed, start, end)
    const sales = salesBoard({ appointments, contacts, now, start, end, callActivity, speed })
    const advisors = advisorBoard({ rows, allRows, appointments, contacts, now, start, end })
    const admins = adminBoard({ allRows, now, start, end })
    const introducers = introducerBoard(rows, 5)
    const soon = now.getTime() + 30 * 86400000
    return {
      speed, sales, advisors, admins, introducers,
      head: headline({ rows, allRows, appointments, contacts, now, start, end, speed }),
      funnel: funnel(rows),
      trend: weeklyTrend({ allRows, appointments, now }),
      honours: honours({ sales, advisors, admins, introducers, speed }),
      stuck: rows.filter((r) => isStuck(r, now)),
      awaiting: rows.filter(isAwaitingClientResponse),
      renewals: allRows.filter((r) => {
        const t = parseDate(productEndDate(r))?.getTime()
        return t !== undefined && t >= now.getTime() - 86400000 && t <= soon
      }),
      openFlags: flags.filter((f) => f.status === 'open'),
    }
  }, [rows, allRows, appointments, flags, callActivity, leadSpeed, now, start, end])

  const current = TEAMS.find((t) => t.id === team)
  const h = m.head

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 xl:grid-cols-6 gap-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)}</div>
        <Skeleton className="h-28" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const salesStats = [
    { label: 'Show rate', value: (r) => pct(r.showRate) },
    { label: 'Calls', value: (r) => fmtInt(r.calls) },
    { label: 'Calls / booking', value: (r) => (r.callsPerBooking === null ? DASH : r.callsPerBooking.toFixed(1)) },
    { label: 'Speed to lead', value: (r) => (r.speedMedian === null ? DASH : fmtMinutes(r.speedMedian)) },
  ]
  const advisorStats = [
    { label: 'Leads assigned', value: (r) => fmtInt(r.assigned) },
    { label: 'Show rate', value: (r) => pct(r.showRate) },
    { label: 'Avg days to complete', value: (r) => (r.avgDays === null ? DASH : fmtDays(r.avgDays)) },
    { label: 'Revenue', value: (r) => (r.revenue ? money(r.revenue) : DASH) },
  ]
  const adminStats = [
    { label: 'Open cases now', value: (r) => fmtInt(r.open) },
    { label: 'At application or later', value: (r) => fmtInt(r.progressed) },
    { label: 'Avg days to complete', value: (r) => (r.avgDays === null ? DASH : fmtDays(r.avgDays)) },
    { label: 'Stuck now', value: (r) => fmtInt(r.stuck) },
  ]

  const funnelData = m.funnel.map((f) => ({ ...f, name: f.label }))
  const speedData = m.speed.buckets.map((b) => ({ name: b.label, count: b.count }))

  return (
    <div className="space-y-5">
      <div className="card px-4 py-3 flex items-start gap-3 text-sm text-muted">
        <Info size={15} className="text-brand-green shrink-0 mt-0.5" />
        <span>
          The date range picks the leads <strong className="text-ink">created</strong> in it and the appointments <strong className="text-ink">booked</strong> in it.
          A completion is counted in the period the case completed (as on the Completion stage, like the other pages). Revenue counts only fees that have been recorded on those leads.
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard label="Leads received" value={fmtInt(h.leads)} onClick={() => openDrilldown(`Leads received: ${fmtInt(h.leads)}`, rows)} />
        <KPICard label="Appointments booked" value={fmtInt(h.booked)} sub="S3 calendar" />
        <KPICard label="Show rate" value={pct(h.showRate)} sub="of appointments due" />
        <KPICard label="Full fact finds" value={fmtInt(h.fullFactFinds)} sub="outcome recorded by the team" />
        <KPICard
          label="Completions"
          value={fmtInt(h.completions)}
          sub={h.avgDays === null ? 'completed in this period' : `completed in this period, ${fmtDays(h.avgDays)} days on average`}
          onClick={() => openDrilldown(`Completions: ${fmtInt(h.completions)}`, allRows.filter((r) => completedInRange(r, start, end)))}
        />
        <KPICard label="Revenue recorded" value={h.revenueRecorded ? money(h.revenue) : DASH} sub={`${fmtInt(h.revenueRecorded)} of ${fmtInt(h.leads)} cases have a fee`} />
      </div>

      <section aria-label="Top of the board">
        <h2 className="sr-only">Top of the board</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <Honour icon={Trophy} label="Top booker" winner={m.honours.booker?.name} value={m.honours.booker && `${fmtInt(m.honours.booker.value)} appointments`} sub="sales team" />
          <Honour
            icon={Zap}
            label="Fastest first call"
            winner={m.honours.responder?.name}
            value={m.honours.responder && fmtMinutes(m.honours.responder.value)}
            sub={m.honours.responder ? `median over ${m.honours.responder.leads} leads` : `needs ${MIN_LEADS_FOR_SPEED}+ leads each`}
          />
          <Honour icon={Trophy} label="Top advisor" winner={m.honours.advisor?.name} value={m.honours.advisor && `${fmtInt(m.honours.advisor.value)} completions`} sub="by completions" />
          <Honour icon={Trophy} label="Top of handover" winner={m.honours.admin?.name} value={m.honours.admin && `${fmtInt(m.honours.admin.value)} completions`} sub="handover team" />
          <Honour icon={Trophy} label="Top introducer" winner={m.honours.introducer?.name} value={m.honours.introducer && money(m.honours.introducer.value)} sub="by recorded revenue" />
        </div>
      </section>

      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">Leaderboards</h2>
            <p className="text-xs text-muted mt-0.5">{current.note}</p>
          </div>
          <div className="inline-flex rounded-lg border border-line overflow-hidden text-xs" role="group" aria-label="Team">
            {TEAMS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTeam(t.id)}
                aria-pressed={team === t.id}
                className={`px-3 py-1.5 transition-colors ${team === t.id ? 'bg-brand-navy text-white' : 'bg-card text-muted hover:text-ink'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {team === 'sales' && (
          <Leaderboard rows={m.sales} primary={{ label: 'Appointments booked', value: (r) => r.booked, format: fmtInt }} stats={salesStats} empty="No sales team activity in this period." />
        )}
        {team === 'advisors' && (
          <Leaderboard rows={m.advisors} primary={{ label: 'Completions', value: (r) => r.completions, format: fmtInt }} stats={advisorStats} empty="No advisor activity in this period." />
        )}
        {team === 'admin' && (
          <Leaderboard rows={m.admins} primary={{ label: 'Completions', value: (r) => r.completions, format: fmtInt }} stats={adminStats} empty="No handover team cases in this period." />
        )}
        {team === 'sales' && (
          <p className="text-xs text-muted mt-3">Speed to lead is shown from {MIN_LEADS_FOR_SPEED} first calls. Full fact finds and conversion to full fact find appear once the team records the Fact Find Outcome.</p>
        )}
        {team === 'admin' && <p className="text-xs text-muted mt-3">Cases owned by anyone outside the handover team are not ranked here (see Case Management, Admin assignment needs review).</p>}
        {team === 'advisors' && <p className="text-xs text-muted mt-3">Revenue and days to complete are for the cases completed in the period.</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 [&>*]:min-w-0">
        <div className="card p-5 lg:col-span-3">
          <h2 className="text-sm font-semibold text-ink">Speed to lead</h2>
          <p className="text-xs text-muted mt-0.5 mb-4 max-w-2xl">
            How long a new lead waits for its first call. The clock starts when the office opens (08:00 to 18:00, Monday to Friday), so a lead that arrives overnight
            is not marked late. Existing clients are left out. Counts Evonex calls made since call tracking began.
          </p>
          {m.speed.leads === 0 ? (
            <p className="text-sm text-muted py-8 text-center">No new leads with call data in this period yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4 mb-3">
                <div>
                  <div className="kpi-label">Median first call</div>
                  <div className="text-2xl font-semibold text-ink mt-1">{fmtMinutes(m.speed.median)}</div>
                </div>
                <div>
                  <div className="kpi-label">Called within 15 min</div>
                  <div className="text-2xl font-semibold text-ink mt-1">{pct(m.speed.pctWithinFifteen)}</div>
                  <div className="text-xs text-muted">{fmtInt(m.speed.withinFifteen)} of {fmtInt(m.speed.leads)} leads</div>
                </div>
                <div>
                  <div className="kpi-label">Not called yet</div>
                  <div className={`text-2xl font-semibold mt-1 ${m.speed.notCalled ? 'text-brand-pink' : 'text-ink'}`}>{fmtInt(m.speed.notCalled)}</div>
                  <div className="text-xs text-muted">no call to their number</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={speedData} margin={{ top: 8, right: 8, left: -12 }}>
                  <CartesianGrid vertical={false} stroke="#E5EAF0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#1F2937' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <Tooltip cursor={{ fill: '#F7F9FB' }} formatter={(v) => [fmtInt(v), 'Leads']} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {speedData.map((d, i) => <Cell key={d.name} fill={SPEED_COLORS[i]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <table className="w-full text-sm mt-3">
                <caption className="sr-only">Median time to first call by caller</caption>
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="font-medium py-1">First caller</th>
                    <th scope="col" className="font-medium py-1 text-right">Leads</th>
                    <th scope="col" className="font-medium py-1 text-right">Median</th>
                    <th scope="col" className="font-medium py-1 text-right">Within 15 min</th>
                  </tr>
                </thead>
                <tbody>
                  {m.speed.byCaller.slice(0, 6).map((c) => (
                    <tr key={c.name} className="border-t border-line">
                      <td className="py-1.5 text-ink">{c.name}{c.onSalesTeam && <span className="ml-2 text-[10px] uppercase tracking-wide text-[#3F7A1E] font-medium">sales</span>}</td>
                      <td className="py-1.5 text-right">{fmtInt(c.leads)}</td>
                      <td className="py-1.5 text-right">{c.enough ? fmtMinutes(c.median) : DASH}</td>
                      <td className="py-1.5 text-right">{c.enough ? `${c.withinFifteen} of ${c.leads}` : DASH}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <ChartCard title="Lead to completion" subtitle="Of the leads received in this period, how far they got" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={funnelData} layout="vertical" margin={{ left: 4, right: 40 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#1F2937' }} />
              <Tooltip cursor={{ fill: '#F7F9FB' }} formatter={(v, _n, p) => [`${fmtInt(v)} (${pct(p.payload.pctOfLeads)} of leads)`, 'Leads']} />
              <Bar dataKey="count" fill={GREEN} radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11, fill: '#1F2937' }} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 [&>*]:min-w-0">
        <ChartCard title="Last 12 weeks" subtitle="Leads created, appointments booked and completions, by week (Monday start)" className="lg:col-span-3">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={m.trend} margin={{ top: 8, right: 12, left: -12 }}>
              <CartesianGrid vertical={false} stroke="#E5EAF0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: PINK }} width={28} />
              <Tooltip />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="left" type="linear" dataKey="leads" name="Leads" stroke={NAVY} strokeWidth={2} dot={false} />
              <Line yAxisId="left" type="linear" dataKey="appointments" name="Appointments" stroke={GREEN} strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="linear" dataKey="completions" name="Completions (right scale)" stroke={PINK} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-ink">Top introducers</h2>
          <p className="text-xs text-muted mt-0.5 mb-2">By recorded revenue in this period</p>
          {m.introducers.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">No introducer leads in this period.</p>
          ) : (
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">Top introducers by recorded revenue</caption>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="font-medium py-1 w-[42%]">Introducer</th>
                  <th scope="col" className="font-medium py-1 text-right">Leads</th>
                  <th scope="col" className="font-medium py-1 text-right">Completed</th>
                  <th scope="col" className="font-medium py-1 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {m.introducers.map((r) => (
                  <tr key={r.name} className="border-t border-line">
                    <td className="py-1.5 text-ink truncate pr-2" title={r.name}>{r.name}</td>
                    <td className="py-1.5 text-right">{fmtInt(r.leads)}</td>
                    <td className="py-1.5 text-right">{fmtInt(r.completions)}</td>
                    <td className="py-1.5 text-right font-medium">{r.revenue ? money(r.revenue) : DASH}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <section aria-label="Needs attention">
        <h2 className="text-sm font-semibold text-ink mb-3">Needs attention</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile to="/cases" label="Stuck cases" value={m.stuck.length} sub="open 30+ days in the first stages" alert />
          <Tile to="/cases" label="Awaiting client" value={m.awaiting.length} sub="documents still pending" />
          <Tile to="/cases" label="Renewals in 30 days" value={m.renewals.length} sub="product end date (ERC)" />
          <Tile to="/flags" label="Open flags" value={m.openFlags.length} sub="data checks to review" alert />
        </div>
      </section>
    </div>
  )
}
