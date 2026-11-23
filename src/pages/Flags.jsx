import { useMemo, useState } from 'react'
import { Check, Info, Pencil, RotateCcw } from 'lucide-react'
import { useData } from '../context/DataContext'
import KPICard from '../components/KPICard'
import DataTable from '../components/DataTable'
import Skeleton from '../components/Skeleton'
import { DASH, fmtDate, fmtInt, parseDate } from '../lib/format'
import { rangeBounds } from '../lib/metrics'
import { FIELD_LABEL, FLAG_TYPES, flagPeople, flagValues, statusText, typeLabel } from '../lib/flags'

const NOTE_MAX = 500 // the same limit as /api/flags

const saveErrorText = (e) =>
  e.message === 'no_write_access'
    ? 'The dashboard cannot save to the sheet yet: its Google service account needs edit access to the sheet. Nothing was changed.'
    : e.message === 'note_too_long'
      ? `That note is too long. Please keep it under ${NOTE_MAX} characters.`
      : 'That change could not be saved, so the flag is back as it was. Please try again.'

export default function Flags() {
  const { loading, flags, setFlagStatus, setFlagNote, allRows, appointments, dateRange, customRange, openDrilldown } = useData()
  const [saving, setSaving] = useState(() => new Set()) // flag ids being saved
  const [saveError, setSaveError] = useState(null)
  const [editing, setEditing] = useState(null) // { id, draft } while a note is being written

  const run = async (flagId, action) => {
    setSaveError(null)
    setSaving((prev) => new Set(prev).add(flagId))
    try {
      await action()
      return true
    } catch (e) {
      setSaveError(saveErrorText(e))
      return false
    } finally {
      setSaving((prev) => {
        const next = new Set(prev)
        next.delete(flagId)
        return next
      })
    }
  }

  const mark = (flagId, status) => run(flagId, () => setFlagStatus(flagId, status))

  const saveNote = async () => {
    if (!editing) return
    const { id, draft } = editing
    if (await run(id, () => setFlagNote(id, draft))) setEditing(null)
  }

  const appointmentById = useMemo(() => new Map(appointments.filter((a) => a.appointment_id).map((a) => [a.appointment_id, a])), [appointments])

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
        const people = flagPeople(lead, appointmentById.get(f.appointment_id))
        return {
          ...lead,
          ...f,
          owner: people.owner,
          advisor: people.advisor,
          note: f.note || '',
          was: shown.was,
          now: shown.now,
          official: shown.official,
          client_name: lead.client_name || nameByContact.get(f.contact_id) || DASH,
          detected_on: detected ? `${fmtDate(detected)} ${detected.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : DASH,
          type_label: typeLabel(f.type),
          status_label: statusText(f.status),
          sorted_on: f.status === 'resolved' && parseDate(f.resolved_at) ? fmtDate(f.resolved_at) : '',
          field_label: FIELD_LABEL[f.field] || f.field || DASH,
          group: FLAG_TYPES[f.type]?.group || 'other',
        }
      })
      .sort((a, b) => String(b.detected_at).localeCompare(String(a.detected_at)))
  }, [flags, leadByContact, nameByContact, appointmentById, dateRange, customRange])

  const open = rows.filter((r) => r.status === 'open')
  const count = (group) => open.filter((r) => r.group === group)

  const COLUMNS = [
    { key: 'detected_on', label: 'Detected' },
    { key: 'type_label', label: 'Flag' },
    { key: 'owner', label: 'Owner' },
    { key: 'advisor', label: 'Advisor' },
    { key: 'was', label: 'Was' },
    { key: 'now', label: 'Now' },
    { key: 'official', label: 'Official (locked or calendar)' },
    { key: 'detail', label: 'What happened' },
    { key: 'note', label: 'Note' },
  ]
  const drill =(title, list) => openDrilldown(`${title}: ${fmtInt(list.length)}`, list, COLUMNS)

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
          <h2 className="text-sm font-semibold text-ink">All flags</h2>
          <p className="text-xs text-muted mt-0.5 mb-4 max-w-3xl">
            Owner is the lead&apos;s Admin; Advisor is the advisor on the flagged appointment (or the case&apos;s advisor). Use the filters to see one
            person&apos;s flags. Once a flag has been looked at, add a note saying what was found (for example, the client rang back on another number),
            then click Mark sorted. Both are saved to the sheet, so everyone sees them, and the open counts above change straight away. Undo opens it again.
          </p>
          {saveError && (
            <p role="alert" className="mb-3 rounded-lg border border-brand-pink/40 bg-brand-pink/5 px-3 py-2 text-sm text-brand-pink">
              {saveError}
            </p>
          )}
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
                { key: 'status_label', label: 'Status' },
                { key: 'owner', label: 'Owner', blankLabel: '(No owner)' },
                { key: 'advisor', label: 'Advisor', blankLabel: '(No advisor)' },
              ]}
              columns={[
                { key: 'detected_on', label: 'Detected', sortValue: (r) => r.detected_at },
                { key: 'type_label', label: 'Flag' },
                { key: 'client_name', label: 'Client' },
                { key: 'owner', label: 'Owner', render: (r) => r.owner || DASH },
                { key: 'advisor', label: 'Advisor', render: (r) => r.advisor || DASH },
                { key: 'field_label', label: 'Field' },
                { key: 'was', label: 'Was' },
                { key: 'now', label: 'Now' },
                { key: 'official', label: 'Official (locked or calendar)' },
                { key: 'detail', label: 'What happened' },
                {
                  key: 'note',
                  label: 'Note',
                  sortable: false,
                  rawForCsv: (r) => r.note,
                  render: (r) => {
                    const busy = saving.has(r.flag_id)
                    if (editing?.id === r.flag_id) {
                      return (
                        <form
                          className="flex min-w-[220px] flex-col gap-1"
                          onSubmit={(e) => {
                            e.preventDefault()
                            saveNote()
                          }}
                        >
                          <textarea
                            autoFocus
                            rows={2}
                            maxLength={NOTE_MAX}
                            value={editing.draft}
                            onChange={(e) => setEditing({ id: r.flag_id, draft: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setEditing(null)
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                saveNote()
                              }
                            }}
                            placeholder="What was found, e.g. client rang back on his mobile"
                            aria-label={`Note for: ${r.type_label}, ${r.client_name}`}
                            className="w-full rounded-md border border-line bg-card px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-green"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              disabled={busy}
                              className="rounded-md bg-brand-green px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50"
                            >
                              {busy ? 'Saving' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setEditing(null)} className="text-xs text-muted hover:text-ink">
                              Cancel
                            </button>
                          </div>
                        </form>
                      )
                    }
                    return (
                      <div className="flex min-w-[160px] items-start gap-1.5">
                        {r.note && <span className="text-xs text-ink">{r.note}</span>}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setEditing({ id: r.flag_id, draft: r.note })}
                          title={r.note ? 'Edit the note' : 'Add a note'}
                          aria-label={`${r.note ? 'Edit note' : 'Add note'}: ${r.type_label}, ${r.client_name}`}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-page hover:text-ink disabled:opacity-50"
                        >
                          <Pencil size={12} /> {r.note ? '' : 'Add note'}
                        </button>
                      </div>
                    )
                  },
                },
                {
                  key: 'status_label',
                  label: 'Status',
                  rawForCsv: (r) => (r.sorted_on ? `${r.status_label} ${r.sorted_on}` : r.status_label),
                  render: (r) => (
                    <span className={r.status === 'open' ? 'text-brand-pink font-medium' : 'text-muted'}>
                      {r.status_label}
                      {r.sorted_on && <span className="text-xs"> {r.sorted_on}</span>}
                    </span>
                  ),
                },
                {
                  key: 'action',
                  label: 'Sorted?',
                  sortable: false,
                  rawForCsv: () => '',
                  render: (r) => {
                    const busy = saving.has(r.flag_id)
                    if (r.status === 'open') {
                      return (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => mark(r.flag_id, 'resolved')}
                          title="Mark this flag as sorted"
                          aria-label={`Mark as sorted: ${r.type_label}, ${r.client_name}`}
                          className="inline-flex items-center gap-1 rounded-md border border-brand-green/60 px-2 py-1 text-xs font-medium text-brand-green hover:bg-brand-green hover:text-white disabled:opacity-50 transition-colors"
                        >
                          <Check size={13} /> {busy ? 'Saving' : 'Mark sorted'}
                        </button>
                      )
                    }
                    if (r.status === 'resolved') {
                      return (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => mark(r.flag_id, 'open')}
                          title="Open this flag again"
                          aria-label={`Open again: ${r.type_label}, ${r.client_name}`}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:text-ink hover:bg-page disabled:opacity-50 transition-colors"
                        >
                          <RotateCcw size={12} /> {busy ? 'Saving' : 'Undo'}
                        </button>
                      )
                    }
                    return null
                  },
                },
              ]}
              rows={rows}
            />
          )}
        </div>
      )}
    </div>
  )
}
