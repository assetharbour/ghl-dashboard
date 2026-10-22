// Field_Locks holds Created By (per contact) and Booked By (per appointment). The dashboard only needs the
// Created By locks, so only those rows and columns leave the server.
export function createdByLocks(values) {
  if (!values.length) return values
  const header = values[0]
  const col = (name) => header.indexOf(name)
  const keep = ['contact_id', 'field', 'first_value', 'first_seen_at', 'current_value'].map(col)
  if (keep.includes(-1)) return []
  const field = col('field')
  const rows = values.slice(1).filter((r) => r[field] === 'created_by')
  return [keep.map((i) => header[i]), ...rows.map((r) => keep.map((i) => r[i] ?? ''))]
}
