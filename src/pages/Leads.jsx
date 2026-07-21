import { useMemo } from 'react'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import DataTable from '../components/DataTable'
import Skeleton from '../components/Skeleton'
import { fmtInt, fmtDate, parseDate, isBlank } from '../lib/format'
import { ADMIN_FILTER_PROPS } from '../lib/metrics'

export default function Leads() {
  const { rows, loading, openDrilldown } = useData()

  const m = useMemo(() => {
    const caseType = (r) => String(r.mortgage_case_type).toLowerCase()
    const purchase = rows.filter((r) => caseType(r).includes('purchase'))
    const remortgage = rows.filter((r) => caseType(r).includes('remortgage'))
    // A call was logged at either stage — admin's first-contact call
    // (Stage 1) or the advisor's own call (Stage 3) — not the pipeline
    // stage proxy, which counted leads that never actually got called.
    const appointments = rows.filter((r) => !isBlank(r.admin_call_status) || !isBlank(r.advisor_call_status))
    return { purchase, remortgage, appointments }
  }, [rows])

  const caseTypeCol = { key: 'mortgage_case_type', label: 'Case Type' }
  const createdCol = { key: 'created_date', label: 'Created', render: (r) => fmtDate(r.created_date) }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
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
          value={fmtInt(m.appointments.length)}
          sub="admin or advisor call logged"
          onClick={() =>
            openDrilldown(
              `Appointments booked: ${fmtInt(m.appointments.length)}`,
              m.appointments,
              [
                { key: 'admin_call_status', label: 'Admin Call Status' },
                { key: 'advisor_call_status', label: 'Advisor Call Status' },
              ]
            )
          }
        />
      </div>

      {loading ? (
        <Skeleton className="h-[560px]" />
      ) : (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink mb-4">All Leads</h3>
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
