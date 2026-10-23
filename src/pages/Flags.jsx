import { useMemo } from 'react'
import { Info } from 'lucide-react'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import DataTable from '../components/DataTable'
import Skeleton from '../components/Skeleton'
import { DASH, fmtDate, fmtInt, parseDate } from '../lib/format'
import { rangeBounds } from '../lib/metrics'
import { FIELD_LABEL, FLAG_TYPES, flagValues, typeLabel } from '../lib/flags'


export default function Flags() {
  const { loading, flags, allRows, appointments, dateRange, customRange, openDrilldown } = useData()

  const leadByContact = useMemo(() => {
    const map = new Map()
    for (const r of allRows) if (r.contact_id && !map.has(r.contact_id)) map.set(r.contact_id, r)
    return map
  }, [allRows])

  // The client's name from the appointment, for contacts that have no case in Leads.
  const nameByContact = useMemo(() => new Map(appointments.filter((a) => a.contact_id && a.contact_name).map((a) => [a.contact_id, a.contact_name])), [appointments])

  const rows = useMemo(() => {
    const b = rangeBounds(dateRange, customRange)
    const to = b?.to ? (b.inclusiveTo ? b.to.getTime() + 1 : b.to.getTime()) : null
    return flags
      .filter((f) => {
        if (!b) return true
        const d = parseDate(f.detected_at)
        return d && d >= b.from && (to === null || d.getTime() < to)
      })
      .map((f) => {
        const lead = leadByContact.get(f.contact_id) || {}
        const detected = parseDate(f.detected_at)
        const shown = flagValues(f)
        return {
          ...lead,
          ...f,
          was: shown.was,
          now: shown.now,
          official: shown.official,
          client_name: lead.client_name || nameByContact.get(f.contact_id) || DASH,
          detected_on: detected ? `${fmtDate(detected)} ${detected.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : DASH,
          type_label: typeLabel(f.type),
          field_label: FIELD_LABEL[f.field] || f.field || DASH,
          group: FLAG_TYPES[f.type]?.group || 'other',
        }
      })
      .sort((a, b) => String(b.detected_at).localeCompare(String(a.detected_at)))
  }, [flags, leadByContact, nameByContact, dateRange, customRange])

  const open = rows.filter((r) => r.status === 'open')
  const count = (group) => open.filter((r) => r.group === group)

  const COLUMNS = [
    { key: 'detected_on', label: 'Detected' },
    { key: 'type_label', label: 'Flag' },
    { key: 'was', label: 'Was' },
    { key: 'now', label: 'Now' },
    { key: 'official', label: 'Official (locked or calendar)' },
    { key: 'detail', label: 'What happened' },
  ]
  const drill = (title, list) => openDrilldown(`${title}: ${fmtInt(list.length)}`, list, COLUMNS)

  const cards = [
    ['Open flags', open, 'Needs a manager to look'],
    ['Created By changed', count('created'), 'changed or cleared after being set'],
    ['Booked By issues', count('booked'), 'changed, cleared, missing or not matching the calendar'],
    ['Advisor checks', count('advisor'), 'differs from the advisor field, or booked with a non-advisor'],
    ['Calls vs calendar', count('calls'), 'status marked on the calendar disagrees with the phone records'],
    ['New booking sources', count('source'), 'a new way of booking appeared'],
  ]

  return (
    <div className="space-y-5">
      <div className="card px-4 py-3 flex items-start gap-3 text-sm text-muted">
        <Info size={15} className="text-brand-green shrink-0 mt-0.5" />
        <span>
          Created By and Booked By are locked the first time they are recorded and reports use the locked value. A flag appears when the value is
          changed or cleared afterwards, when Booked By is still empty a day after booking, or when it does not match who booked the appointment in the
          calendar. GHL does not record who changed a field, so a flag shows what changed and when. The date range applies to the day the flag was
          detected. The Calls vs calendar card compares the status staff marked (Showed, No-show) with the advisor&apos;s Evonex call around the appointment time; the
          calendar status is never changed, it is only flagged.
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map(([label, list, sub]) => (
          <KPICard key={label} label={label} value={fmtInt(list.length)} sub={sub} alert={list.length > 0 && label !== 'New booking sources'} onClick={() => drill(label, list)} />
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-ink mb-4">All flags</h2>
          {flags.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">
              No flags yet. They appear once the sync&apos;s field audit has run (FIELD_AUDIT=on) and something needs attention.
            </p>
          ) : (
            <DataTable
              pageSize={20}
              exportName="flags"
              filters={[
                { key: 'type_label', label: 'Flag' },
                { key: 'status', label: 'Status' },
              ]}
              columns={[
                { key: 'detected_on', label: 'Detected', sortValue: (r) => r.detected_at },
                { key: 'type_label', label: 'Flag' },
                { key: 'client_name', label: 'Client' },
                { key: 'field_label', label: 'Field' },
                { key: 'was', label: 'Was' },
                { key: 'now', label: 'Now' },
                { key: 'official', label: 'Official (locked or calendar)' },
                { key: 'detail', label: 'What happened' },
                { key: 'status', label: 'Status' },
              ]}
              rows={rows}
            />
          )}
        </div>
      )}
    </div>
  )
}
