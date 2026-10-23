import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { Info } from 'lucide-react'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import DataTable from '../components/DataTable'
import Skeleton from '../components/Skeleton'
import { DASH, fmtDate, fmtInt, parseDate } from '../lib/format'
import { CHART_COLORS, rangeBounds } from '../lib/metrics'
import {
  ADVISORS,
  SALES_TEAM,
  UNKNOWN,
  bookedInPeriod,
  buildSalesTable,
  contactInfoFromLeads,
  createdByReport,
  creditedAppointments,
  forwardWeek,
  fullFactFindsByMonth,
  isDue,
  lastMonths,
  namesMatch,
  roundRobinFairness,
  startsInFuture,
  sumRows,
  weeklyBookings,
} from '../lib/sales'

import { callActivityTable, evidenceById, evidenceSummary, fmtTalk, RESULT_LABEL } from '../lib/calls'

const pct = (r) => (r === null || r === undefined ? DASH : `${(r * 100).toFixed(1)}%`)
const bookerOf = (a) => a.booked_by_official || UNKNOWN
const BASIS_LABEL = { calendar: 'Calendar', field: 'Booked By field' }
const STATUS_LABEL = { new: 'New', confirmed: 'Confirmed', showed: 'Showed', noshow: 'No-show', cancelled: 'Cancelled', invalid: 'Invalid' }

const isSalesTeamBooker = (a) => SALES_TEAM.some((n) => namesMatch(bookerOf(a), n))

export default function Sales() {
  const { loading, allRows, rows: leadRows, appointments, locks, callEvidence, callActivity, dateRange, customRange, openDrilldown } = useData()
  const [scope, setScope] = useState('team') // 'team' = Harry, Ava and Hugo; 'all' = every booker
  const [advisor, setAdvisor] = useState('all')
  // Which date the range filters: the day the appointment was BOOKED (default) or the day it TAKES PLACE (scope 1.5).
  const [dateField, setDateField] = useState('booked_at')
  const byAppointment = dateField === 'start_time'

  // "Now" is refreshed whenever new data arrives (not on every render), so one render pass uses one clock.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [appointments])
  const { start, end } = useMemo(() => {
    const b = rangeBounds(dateRange, customRange, now)
    if (!b) return { start: null, end: null }
    return { start: b.from, end: b.to ? new Date(b.to.getTime() + (b.inclusiveTo ? 1 : 0)) : null }
  }, [dateRange, customRange, now])

  const contacts = useMemo(() => contactInfoFromLeads(allRows), [allRows])
  const leadByContact = useMemo(() => {
    const map = new Map()
    for (const r of allRows) if (r.contact_id && !map.has(r.contact_id)) map.set(r.contact_id, r)
    return map
  }, [allRows])

  const evidenceOf = useMemo(() => evidenceById(callEvidence), [callEvidence])

  const scoped = useMemo(() => (scope === 'team' ? appointments.filter(isSalesTeamBooker) : appointments), [appointments, scope])
  const bookerAppts = useMemo(
    () => (advisor === 'all' ? scoped : scoped.filter((a) => namesMatch(a.advisor, advisor))),
    [scoped, advisor]
  )

  const bookerTable = useMemo(
    () => buildSalesTable(bookerAppts, contacts, now, { start, end, group: 'booker', salesTeam: SALES_TEAM, dateField }),
    [bookerAppts, contacts, now, start, end, dateField]
  )
  const advisorTable = useMemo(
    () => buildSalesTable(scoped, contacts, now, { start, end, group: 'advisor', dateField }),
    [scoped, contacts, now, start, end, dateField]
  )
  const totals = useMemo(() => sumRows(bookerTable), [bookerTable])

  // One row per appointment booked in the period, joined to the client (for the table and every drill-down).
  const detail = useMemo(() => {
    const { creditedFf, creditedCompleted } = creditedAppointments(appointments, contacts, now)
    return bookerAppts
      .filter((a) => bookedInPeriod(a, start, end, dateField))
      .map((a) => {
        const lead = leadByContact.get(a.contact_id) || {}
        const booked = parseDate(a.booked_at)
        const starts = parseDate(a.start_time)
        return {
          ...lead,
          ...a,
          client_name: lead.client_name || a.contact_name || DASH, // a contact with no case in Leads still has its name on the appointment
          advisor_name: a.advisor, // the drill-down's advisor filter reads this
          booked_on: booked ? fmtDate(booked) : DASH,
          appointment_on: starts ? `${fmtDate(starts)} ${starts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : DASH,
          booker: bookerOf(a),
          basis: BASIS_LABEL[a.booked_by_basis] || DASH,
          status_label: STATUS_LABEL[a.status] || a.status || DASH,
          full_ff: creditedFf.has(a.appointment_id) && isDue(a, now) ? 'Yes' : '',
          completed_label: creditedCompleted.has(a.appointment_id) && isDue(a, now) ? 'Yes' : '',
          __due: isDue(a, now),
          __upcoming: startsInFuture(a, now),
          __evidence: evidenceOf.get(a.appointment_id) || null,
          advisor_call: evidenceOf.has(a.appointment_id) ? RESULT_LABEL[evidenceOf.get(a.appointment_id).result] || evidenceOf.get(a.appointment_id).result : DASH,
          advisor_talk: evidenceOf.has(a.appointment_id) ? fmtTalk(evidenceOf.get(a.appointment_id).best_talk_seconds) : DASH,
        }
      })
      .sort((x, y) => String(y.booked_at).localeCompare(String(x.booked_at)))
  }, [appointments, bookerAppts, contacts, leadByContact, now, start, end, dateField, evidenceOf])

  const DETAIL_COLUMNS = [
    { key: 'booked_on', label: 'Booked on' },
    { key: 'appointment_on', label: 'Appointment' },
    { key: 'booker', label: 'Booked by' },
    { key: 'status_label', label: 'Status' },
    { key: 'advisor_call', label: 'Advisor call' },
    { key: 'advisor_talk', label: 'Talk time' },
    { key: 'full_ff', label: 'Full fact find' },
    { key: 'completed_label', label: 'Completed' },
  ]
  const callSummary = useMemo(() => evidenceSummary(detail), [detail])
  // Calls per appointment booked always uses the BOOKED date, whichever date the range is filtering.
  const bookedByPerson = useMemo(
    () => Object.fromEntries(buildSalesTable(appointments.filter(isSalesTeamBooker), contacts, now, { start, end, group: 'booker', salesTeam: SALES_TEAM }).map((r) => [r.person, r.booked])),
    [appointments, contacts, now, start, end]
  )
  const activity = useMemo(
    () => callActivityTable(callActivity, start, end, { salesTeam: SALES_TEAM, bookedByPerson }).map((r) => ({
      ...r,
      role: r.onTeam ? 'Sales team' : '',
      answerPct: pct(r.answerRate),
      talk: fmtTalk(r.talkSeconds),
      bookedShown: r.booked === null ? DASH : fmtInt(r.booked),
      perBooking: r.callsPerBooking === null ? DASH : r.callsPerBooking.toFixed(1),
    })),
    [callActivity, start, end, bookedByPerson]
  )
  const drill = (title, pred) => {
    const picked = detail.filter(pred)
    openDrilldown(`${title}: ${fmtInt(picked.length)}`, picked, DETAIL_COLUMNS)
  }

  const weekly = useMemo(() => weeklyBookings(bookerAppts, bookerOf, { start, end, dateField }), [bookerAppts, start, end, dateField])
  const noShowWeekly = useMemo(
    () => weeklyBookings(bookerAppts.filter((a) => a.status === 'noshow'), bookerOf, { start, end, dateField }),
    [bookerAppts, start, end, dateField]
  )
  const fairness = useMemo(() => roundRobinFairness(scoped, ADVISORS, { start, end, dateField }), [scoped, start, end, dateField])
  const equalShare = fairness.length ? fairness.reduce((t, r) => t + r.appointments, 0) / ADVISORS.length : 0
  const ahead = useMemo(() => forwardWeek(scoped, now), [scoped, now])
  const months = useMemo(() => lastMonths(now, 6), [now])
  const ffByAdvisor = useMemo(() => fullFactFindsByMonth(scoped, contacts, now, (a) => a.advisor || UNKNOWN, months), [scoped, contacts, now, months])
  const ffByBooker = useMemo(() => fullFactFindsByMonth(scoped, contacts, now, bookerOf, months), [scoped, contacts, now, months])
  const createdBy = useMemo(() => createdByReport(leadRows, locks, appointments, contacts), [leadRows, locks, appointments, contacts])

  const noData = !loading && appointments.length === 0
  const advisorNames = useMemo(() => [...new Set([...ADVISORS, ...appointments.map((a) => a.advisor).filter(Boolean)])].sort(), [appointments])

  const rowDrill = (r) => drill(`${r.person}: appointments booked`, (d) => d.booker === r.person)

  const personColumns = (label) => [
    { key: 'person', label },
    { key: 'booked', label: 'Booked' },
    { key: 'showed', label: 'Showed' },
    { key: 'noShow', label: 'No-shows' },
    { key: 'cancelled', label: 'Cancelled' },
    { key: 'rebooked', label: 'Rebooked' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'fullFactFinds', label: 'Full fact finds' },
    { key: 'completed', label: 'Completed' },
    { key: 'showRatePct', label: 'Show rate' },
    { key: 'conversionPct', label: 'Booked → full fact find' },
    { key: 'completionPct', label: 'Booked → completed' },
  ]
  const withPct = (table) =>
    table.map((r) => ({
      ...r,
      showRatePct: pct(r.showRate),
      conversionPct: pct(r.conversion),
      completionPct: pct(r.conversionToCompletion),
    }))

  return (
    <div className="space-y-5">
      <div className="card px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
        <Info size={15} className="text-brand-green shrink-0" />
        <span className="text-muted flex-1 min-w-[260px]">
          The date range applies to the day each appointment was <strong className="text-ink">{byAppointment ? 'held (appointment date)' : 'booked'}</strong>.
          The booker is the Booked By field when it is filled in (the first value is locked), otherwise the person GHL recorded on the calendar.
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line overflow-hidden text-xs" role="group" aria-label="Date range applies to">
            {[['booked_at', 'Booked date'], ['start_time', 'Appointment date']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setDateField(id)}
                aria-pressed={dateField === id}
                className={`px-3 py-1.5 transition-colors ${dateField === id ? 'bg-brand-navy text-white' : 'bg-card text-muted hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-line overflow-hidden text-xs">
            {[['team', 'Sales team'], ['all', 'All bookers']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setScope(id)}
                aria-pressed={scope === id}
                className={`px-3 py-1.5 transition-colors ${scope === id ? 'bg-brand-navy text-white' : 'bg-card text-muted hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            aria-label="Filter by advisor"
            value={advisor}
            onChange={(e) => setAdvisor(e.target.value)}
            className="text-sm border border-line rounded-lg px-2.5 py-1.5 bg-card text-ink focus:outline-none focus:ring-2 focus:ring-brand-green/40"
          >
            <option value="all">All advisors</option>
            {advisorNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {noData && (
        <div className="card px-5 py-8 text-center text-sm text-muted">
          No appointment data yet. It appears here once the sync&apos;s appointment audit has run (FIELD_AUDIT=on).
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          label={byAppointment ? 'Appointments in period' : 'Appointments booked'}
          value={fmtInt(totals.booked)}
          sub={byAppointment ? 'by appointment date' : undefined}
          onClick={() => drill(byAppointment ? 'Appointments in period' : 'Appointments booked', () => true)}
        />
        <KPICard
          label="Showed"
          value={fmtInt(totals.showed)}
          sub={`${pct(totals.showRate)} of ${fmtInt(totals.due)} due`}
          onClick={() => drill('Showed', (d) => d.status === 'showed')}
        />
        <KPICard
          label="No-shows"
          value={fmtInt(totals.noShow)}
          sub={`${fmtInt(totals.rebooked)} no-shows and cancellations were rebooked`}
          alert={totals.noShow > 0}
          onClick={() => drill('No-shows', (d) => d.status === 'noshow')}
        />
        <KPICard label="Cancelled" value={fmtInt(totals.cancelled)} onClick={() => drill('Cancelled', (d) => d.status === 'cancelled')} />
        <KPICard
          label="Full fact finds"
          value={fmtInt(totals.fullFactFinds)}
          sub="outcome recorded as Full Fact Find"
          onClick={() => drill('Full fact finds', (d) => d.full_ff === 'Yes')}
        />
        <KPICard
          label="Booked → full fact find"
          value={pct(totals.conversion)}
          sub={`${fmtInt(totals.fullFactFinds)} of ${fmtInt(totals.due)} appointments due`}
          onClick={() => drill('Appointments due (the conversion denominator)', (d) => d.__due)}
        />
        <KPICard
          label="Completed"
          value={fmtInt(totals.completed)}
          sub="mortgage completed after booking"
          onClick={() => drill('Completed', (d) => d.completed_label === 'Yes')}
        />
        <KPICard
          label="Booked → completed"
          value={pct(totals.conversionToCompletion)}
          sub={`${fmtInt(totals.completed)} of ${fmtInt(totals.due)} appointments due`}
          onClick={() => drill('Appointments due (the conversion denominator)', (d) => d.__due)}
        />
      </div>

      {loading ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-ink">{scope === 'team' ? 'Sales team performance' : 'Performance by booker'}</h2>
          <p className="text-xs text-muted mt-0.5 mb-4">
            One row per person who booked an appointment in the period. Click a row to see the appointments.
            Conversion is full fact finds (or completions) divided by appointments that should have happened by now.
          </p>
          <DataTable
            searchable={false}
            pageSize={15}
            exportName="sales_team_performance"
            columns={personColumns('Booked by')}
            rows={withPct(bookerTable)}
            onRowClick={rowDrill}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 [&>*]:min-w-0">
        <ChartCard
          title={byAppointment ? 'Appointments per week' : 'Appointments booked per week'}
          subtitle={`By week of ${byAppointment ? 'the appointment' : 'booking'} (Monday start), per person`}
        >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={weekly.weeks} margin={{ left: -10, right: 8 }}>
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <Tooltip cursor={{ fill: '#F7F9FB' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              {weekly.people.map((p, i) => (
                <Bar key={p} dataKey={p} stackId="w" fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="No-shows per week" subtitle="Appointments that did not show, by week they were booked, per person">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={noShowWeekly.weeks} margin={{ left: -10, right: 8 }}>
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <Tooltip cursor={{ fill: '#F7F9FB' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              {noShowWeekly.people.map((p, i) => (
                <Bar key={p} dataKey={p} stackId="n" fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 [&>*]:min-w-0">
        <ChartCard
          title="Round robin: appointments per advisor"
          subtitle={`Bookings in the period against an equal share (${equalShare.toFixed(1)} each). Bars far from the line are an unfair split`}
        >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={fairness} layout="vertical" margin={{ left: 8, right: 24 }}>
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis type="category" dataKey="person" width={150} tick={{ fontSize: 11, fill: '#1F2937' }} />
              <Tooltip cursor={{ fill: '#F7F9FB' }} formatter={(v) => [fmtInt(v), 'Appointments']} />
              <ReferenceLine x={equalShare} stroke="#E91E63" strokeDasharray="4 3" />
              <Bar dataKey="appointments" fill="#6DA544" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        {loading ? (
          <Skeleton className="h-80" />
        ) : (
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink">Appointments by advisor</h2>
            <p className="text-xs text-muted mt-0.5 mb-4">Who holds the meeting. Not the same as who booked it.</p>
            <DataTable
              searchable={false}
              pageSize={10}
              exportName="appointments_by_advisor"
              columns={personColumns('Advisor')}
              rows={withPct(advisorTable)}
              onRowClick={(r) => drill(`${r.person}: appointments`, (d) => (d.advisor || UNKNOWN) === r.person)}
            />
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Next working week</h2>
        <p className="text-xs text-muted mt-0.5 mb-4">
          Appointments for {fmtDate(ahead.days[0].date)} to {fmtDate(ahead.days[4].date)} (cancelled ones excluded). Click a day to see them.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {ahead.days.map((day) => {
            const byAdvisor = {}
            for (const a of day.appointments) byAdvisor[a.advisor || UNKNOWN] = (byAdvisor[a.advisor || UNKNOWN] || 0) + 1
            const open = () => {
              const picked = day.appointments.map((a) => {
                const lead = leadByContact.get(a.contact_id) || {}
                const starts = parseDate(a.start_time)
                return {
                  ...lead, ...a, client_name: lead.client_name || a.contact_name || DASH, advisor_name: a.advisor,
                  booker: bookerOf(a), appointment_on: starts ? starts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : DASH,
                  status_label: STATUS_LABEL[a.status] || a.status || DASH,
                }
              })
              openDrilldown(`${day.label}: ${fmtInt(picked.length)} appointments`, picked, [
                { key: 'appointment_on', label: 'Time' },
                { key: 'booker', label: 'Booked by' },
                { key: 'status_label', label: 'Status' },
              ])
            }
            return (
              <button key={day.key} onClick={open} className="text-left border border-line rounded-lg p-3 hover:border-brand-green/50 transition-colors">
                <div className="text-xs text-muted">{day.label}</div>
                <div className="text-2xl font-semibold text-ink mt-0.5">{fmtInt(day.appointments.length)}</div>
                <div className="mt-1 space-y-0.5">
                  {Object.entries(byAdvisor).map(([name, n]) => (
                    <div key={name} className="text-[11px] text-muted flex justify-between">
                      <span className="truncate pr-2">{name}</span>
                      <span>{n}</span>
                    </div>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Advisor calls against appointments</h2>
        <p className="text-xs text-muted mt-0.5 mb-4 max-w-3xl">
          Advisor appointments are phone calls made from Evonex, so a connected call by the advisor to the client within three hours of the appointment time is
          the evidence it took place (the advisor may have used another number, so a mismatch is something to review, not proof). The status staff marked on the calendar is never changed by this; where the two disagree it is flagged on the Flags page.
          Only appointments that finished at least two hours ago, and that fall inside the Evonex call history, are judged.
        </p>
        {callEvidence.length === 0 ? (
          <p className="text-sm text-muted py-4 text-center">No call evidence yet. It appears once the sync has run with CALL_EVIDENCE=on.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              label="Judged by calls"
              value={fmtInt(callSummary.judged.length)}
              sub="appointments below with call records"
              onClick={() => openDrilldown(`Appointments judged by calls: ${fmtInt(callSummary.judged.length)}`, callSummary.judged, DETAIL_COLUMNS)}
            />
            <KPICard
              label="Real conversation"
              value={fmtInt(callSummary.talked.length)}
              sub={callSummary.judged.length ? `${pct(callSummary.talked.length / callSummary.judged.length)} of those judged (a minute or more)` : undefined}
              onClick={() => openDrilldown(`Real conversation: ${fmtInt(callSummary.talked.length)}`, callSummary.talked, DETAIL_COLUMNS)}
            />
            <KPICard
              label="No real conversation"
              value={fmtInt(callSummary.noConversation.length)}
              sub="short call, not answered, or no call"
              alert={callSummary.noConversation.length > 0}
              onClick={() => openDrilldown(`No real conversation: ${fmtInt(callSummary.noConversation.length)}`, callSummary.noConversation, DETAIL_COLUMNS)}
            />
            <KPICard
              label="No call at all"
              value={fmtInt(callSummary.noCall.length)}
              sub="no call to the client around that time"
              onClick={() => openDrilldown(`No call at all: ${fmtInt(callSummary.noCall.length)}`, callSummary.noCall, DETAIL_COLUMNS)}
            />
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Call activity</h2>
        <p className="text-xs text-muted mt-0.5 mb-4 max-w-3xl">
          Outbound Evonex calls per person for the days in the date range. A call counts as a conversation from one minute of talk time and as a long call from
          ten minutes. For the sales team, calls per appointment booked uses the appointments they booked in the same range (scope 1.11).
        </p>
        {activity.length === 0 ? (
          <p className="text-sm text-muted py-4 text-center">No call activity in this period (or the sync has not run with CALL_EVIDENCE=on yet).</p>
        ) : (
          <DataTable
            searchable={false}
            pageSize={15}
            exportName="call_activity"
            columns={[
              { key: 'caller', label: 'Caller' },
              { key: 'role', label: 'Role' },
              { key: 'calls', label: 'Calls', sortValue: (r) => r.calls },
              { key: 'connected', label: 'Connected', sortValue: (r) => r.connected },
              { key: 'answerPct', label: 'Answer rate', sortValue: (r) => r.answerRate ?? -1 },
              { key: 'conversations', label: 'Conversations', sortValue: (r) => r.conversations },
              { key: 'longCalls', label: 'Long calls', sortValue: (r) => r.longCalls },
              { key: 'talk', label: 'Talk time', sortValue: (r) => r.talkSeconds },
              { key: 'bookedShown', label: 'Appointments booked', sortValue: (r) => r.booked ?? -1 },
              { key: 'perBooking', label: 'Calls per booking', sortValue: (r) => r.callsPerBooking ?? -1 },
            ]}
            rows={activity}
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 [&>*]:min-w-0">
        <MonthMatrix
          title="Full fact finds by advisor, by month"
          subtitle="The pay report. Counted in the month of the appointment, once per client"
          months={months}
          rows={ffByAdvisor}
          loading={loading}
          name="full_fact_finds_by_advisor"
          label="Advisor"
        />
        <MonthMatrix
          title="Full fact finds by sales rep, by month"
          subtitle="Credited to the person who booked the appointment"
          months={months}
          rows={ffByBooker}
          loading={loading}
          name="full_fact_finds_by_booker"
          label="Booked by"
        />
      </div>

      {loading ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-ink">Leads added, by who created them</h2>
          <p className="text-xs text-muted mt-0.5 mb-4">
            Uses the locked Created By value (the first one ever recorded). The date range applies to the day the lead was created.
            &quot;Not recorded&quot; means Created By was never filled in, or the sync has not locked it yet.
          </p>
          <DataTable
            searchable={false}
            pageSize={10}
            exportName="leads_by_created_by"
            columns={[
              { key: 'person', label: 'Created by' },
              { key: 'leads', label: 'Leads added' },
              { key: 'appointments', label: 'Had an appointment booked' },
              { key: 'fullFactFinds', label: 'Full fact finds' },
            ]}
            rows={createdBy}
          />
        </div>
      )}

      {loading ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-ink mb-4">{byAppointment ? 'Appointments held in the period' : 'Appointments booked in the period'}</h2>
          <DataTable
            pageSize={15}
            exportName="appointments_booked"
            initialSort={{ key: 'booked_on', dir: 'desc' }}
            filters={[
              { key: 'booker', label: 'Booked by' },
              { key: 'advisor', label: 'Advisor' },
              { key: 'status_label', label: 'Status' },
            ]}
            columns={[
              { key: 'client_name', label: 'Client' },
              { key: 'booked_on', label: 'Booked on', sortValue: (r) => r.booked_at },
              { key: 'appointment_on', label: 'Appointment', sortValue: (r) => r.start_time },
              { key: 'booker', label: 'Booked by' },
              { key: 'basis', label: 'Source' },
              { key: 'advisor', label: 'Advisor' },
              { key: 'mortgage_case_type', label: 'Case type' },
              { key: 'lead_source', label: 'Lead source' },
              { key: 'status_label', label: 'Status' },
              { key: 'advisor_call', label: 'Advisor call' },
              { key: 'advisor_talk', label: 'Talk time' },
              { key: 'fact_find_date', label: 'Fact find date', render: (r) => fmtDate(r.fact_find_date), sortValue: (r) => r.fact_find_date || '' },
              { key: 'full_ff', label: 'Full fact find' },
              { key: 'completed_label', label: 'Completed' },
            ]}
            rows={detail}
          />
        </div>
      )}
    </div>
  )
}

function MonthMatrix({ title, subtitle, months, rows, loading, name, label }) {
  if (loading) return <Skeleton className="h-72" />
  const totals = months.map((m) => rows.reduce((t, r) => t + r.counts[m.key], 0))
  const flat = rows.map((r) => ({ person: r.person, ...r.counts, total: r.total }))
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="text-xs text-muted mt-0.5 mb-4">{subtitle}</p>
      <DataTable
        searchable={false}
        pageSize={12}
        exportName={name}
        columns={[
          { key: 'person', label },
          ...months.map((m) => ({ key: m.key, label: m.label })),
          { key: 'total', label: 'Total' },
        ]}
        rows={flat}
      />
      {rows.length > 0 && (
        <div className="text-xs text-muted mt-2 flex gap-4 flex-wrap">
          <span className="font-medium text-ink">All</span>
          {months.map((m, i) => (
            <span key={m.key}>
              {m.label}: {totals[i]}
            </span>
          ))}
        </div>
      )}
      {!rows.length && <p className="text-xs text-muted mt-2">No full fact finds recorded in these months yet.</p>}
    </div>
  )
}
