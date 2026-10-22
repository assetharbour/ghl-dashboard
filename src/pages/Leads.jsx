import { useMemo } from 'react'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import DataTable from '../components/DataTable'
import Skeleton from '../components/Skeleton'
import { fmtInt, fmtDate, parseDate, isBlank, DASH } from '../lib/format'
import { ADMIN_FILTER_PROPS } from '../lib/metrics'

export default function Leads() {
  const { rows, loading, openDrilldown, appointments } = useData()

  const m = useMemo(() => {
    const caseType = (r) => String(r.mortgage_case_type).toLowerCase()
    const purchase = rows.filter((r) => caseType(r).includes('purchase'))
    const remortgage = rows.filter((r) => caseType(r).includes('remortgage'))
    // A call outcome was logged at either stage: the admin's first-contact call (Stage 1) or the advisor's own call
    // (Stage 3). This is what this page called "Appointments Booked" until 22 Oct 2026; it counts CALLS, not meetings.
    const callsLogged = rows.filter((r) => !isBlank(r.admin_call_status) || !isBlank(r.advisor_call_status))

    // Appointments Booked = leads that have an appointment in the GHL calendar (the same appointments the Sales Team
    // page counts), one per client: the client's latest booking is shown.
    const latest = new Map()
    for (const a of appointments) {
      if (!a.contact_id || String(a.deleted ?? '').trim() !== '') continue
      const best = latest.get(a.contact_id)
      if (!best || String(a.booked_at) > String(best.booked_at)) latest.set(a.contact_id, a)
    }
    const withAppointment = rows
      .filter((r) => latest.has(r.contact_id))
      .map((r) => {
        const a = latest.get(r.contact_id)
        return {
          ...r,
          appt_booked_on: fmtDate(a.booked_at),
          appt_on: fmtDate(a.start_time),
          appt_booker: a.booked_by_official || DASH,
          appt_status: a.status || DASH,
        }
      })
    return { purchase, remortgage, callsLogged, withAppointment, hasCalendar: appointments.length > 0 }
  }, [rows, appointments])

  const caseTypeCol = { key: 'mortgage_case_type', label: 'Case Type' }
  const createdCol = { key: 'created_date', label: 'Created', render: (r) => fmtDate(r.created_date) }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <KPICard
          label="Total Leads"
          value={fmtInt(rows.length)}
          onClick={() => openDrilldown(`All leads: ${fmtInt(rows.length)}`, rows, [createdCol])}
        />
        <KPICard
          label="Purchase Cases"
          value={fmtInt(m.purchase.length)}
          onClick={() =>
            openDrilldown(`Purchase cases: ${fmtInt(m.purchase.length)}`, m.purchase, [caseTypeCol])
          }
        />
        <KPICard
          label="Remortgage Cases"
          value={fmtInt(m.remortgage.length)}
          onClick={() =>
            openDrilldown(`Remortgage cases: ${fmtInt(m.remortgage.length)}`, m.remortgage, [caseTypeCol])
          }
        />
        <KPICard
          label="Appointments Booked"
          value={m.hasCalendar ? fmtInt(m.withAppointment.length) : DASH}
          sub={m.hasCalendar ? 'leads with a calendar appointment' : 'calendar data not available yet'}
          onClick={() =>
            openDrilldown(`Appointments booked: ${fmtInt(m.withAppointment.length)}`, m.withAppointment, [
              { key: 'appt_booked_on', label: 'Booked on' },
              { key: 'appt_on', label: 'Appointment' },
              { key: 'appt_booker', label: 'Booked by' },
              { key: 'appt_status', label: 'Status' },
            ])
          }
        />
        <KPICard
          label="Calls Logged"
          value={fmtInt(m.callsLogged.length)}
          sub="admin or advisor call outcome recorded"
          onClick={() =>
            openDrilldown(`Calls logged: ${fmtInt(m.callsLogged.length)}`, m.callsLogged, [
              { key: 'admin_call_status', label: 'Admin Call Status' },
              { key: 'advisor_call_status', label: 'Advisor Call Status' },
            ])
          }
        />
      </div>

      {loading ? (
        <Skeleton className="h-[560px]" />
      ) : (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-ink mb-4">All Leads</h2>
          <DataTable
            columns={[
              { key: 'client_name', label: 'Client' },
              { key: 'lead_source', label: 'Lead Source' },
              { key: 'negotiator', label: 'Negotiator' },
              { key: 'advisor_name', label: 'Advisor' },
              { key: 'admin', label: 'Admin' },
              { key: 'pipeline_stage', label: 'Stage' },
              { key: 'case_status', label: 'Status' },
              {
                key: 'created_date',
                label: 'Created',
                render: (r) => fmtDate(r.created_date),
                sortValue: (r) => parseDate(r.created_date)?.getTime() ?? null,
              },
            ]}
            rows={rows}
            filters={[
              { key: 'lead_source', label: 'Source' },
              { key: 'pipeline_stage', label: 'Stage' },
              { key: 'admin', label: 'Admin', ...ADMIN_FILTER_PROPS },
              { key: 'advisor_name', label: 'Advisor', blankLabel: '(No advisor assigned)' },
            ]}
            pageSize={25}
            exportName="asset_harbour_leads"
            initialSort={{ key: 'created_date', dir: 'desc' }}
          />
        </div>
      )}
    </div>
  )
}
