// Flags are written by the sync's field audit (ghl-reporting-sync/app/field_audit.py). They record what changed
// and when; GHL cannot say who changed a field. The Created By and Booked By values used in reports are the
// LOCKED ones, so a flag never changes a report, it tells a manager to look.
import { RESULT_LABEL } from './calls'

export const FLAG_TYPES = {
  created_by_changed: { label: 'Created By changed', group: 'created' },
  created_by_cleared: { label: 'Created By cleared', group: 'created' },
  booked_by_changed: { label: 'Booked By changed', group: 'booked' },
  booked_by_cleared: { label: 'Booked By cleared', group: 'booked' },
  booked_by_missing: { label: 'Booked By missing', group: 'booked' },
  booked_by_mismatch: { label: 'Booked By differs from the calendar', group: 'booked' },
  advisor_mismatch: { label: 'Advisor differs from the calendar', group: 'advisor' },
  appointment_with_non_advisor: { label: 'Appointment given to a non-advisor', group: 'advisor' },
  booking_source_not_trusted: { label: 'New booking source', group: 'source' },
  booker_not_owner: { label: 'Booked by someone other than the lead owner', group: 'booked' },
  showed_without_call: { label: 'Marked Showed, no advisor call', group: 'calls' },
  noshow_with_call: { label: 'Marked No-show, but the advisor spoke to the client', group: 'calls' },
  unmarked_with_call: { label: 'Advisor call held, appointment not marked', group: 'calls' },
}

// What the Was / Now / Official columns mean differs by flag, so each type shows its own meaning:
//   changed / cleared   Was = the value before, Now = the value after, Official = the locked first value
//   Booked By missing   Official = who the calendar says booked it
//   Booked By mismatch  Now = what was entered in the Booked By field, Official = who the calendar says booked it
//   advisor mismatch    Now = the advisor-name field, Official = the advisor the calendar gave it to
//   call flags          Was = the status marked on the calendar, Now = what the phone records show
//   not the lead owner  Now = who booked it, Official = the lead's owner
const STATUS_LABEL = { showed: 'Showed', noshow: 'No-show', confirmed: 'Confirmed', new: 'New', '(blank)': 'Not marked' }
export function flagValues(f) {
  switch (f.type) {
    case 'showed_without_call':
    case 'noshow_with_call':
    case 'unmarked_with_call':
      return { was: STATUS_LABEL[f.old_value] || f.old_value, now: RESULT_LABEL[f.new_value] || f.new_value, official: '' }
    case 'booker_not_owner':
      return { was: '', now: f.new_value, official: f.old_value }
    case 'booked_by_missing':
      return { was: '', now: '', official: f.locked_value || f.new_value }
    case 'booked_by_mismatch':
      return { was: '', now: f.old_value, official: f.locked_value || f.new_value }
    case 'advisor_mismatch':
      return { was: '', now: f.old_value, official: f.new_value }
    default:
      return { was: f.old_value, now: f.new_value, official: f.locked_value }
  }
}

export const FIELD_LABEL = { appointment_status: 'Appointment status', created_by: 'Created By', booked_by: 'Booked By', advisor_name: 'Advisor name', advisor: 'Advisor', booked_source: 'Booking source' }
export const typeLabel = (t) => FLAG_TYPES[t]?.label || t
